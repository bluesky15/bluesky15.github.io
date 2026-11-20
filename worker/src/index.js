/**
 * Standalone Cloudflare Worker for onlinelkb.in — private admin tool.
 *
 * Attached routes (see wrangler.toml):
 *   onlinelkb.in/login          -> login form + D1 credential check
 *   onlinelkb.in/hello          -> gated admin app
 *                                 nav: [New entry] [My notes]
 *                                 My notes = master-detail: list left, selected
 *                                 note's text + images on the right
 *   onlinelkb.in/logout         -> clears session
 *   onlinelkb.in/api/entries*   -> JSON API (list/create/update/delete, gated)
 *   onlinelkb.in/api/trade_journal/calendar -> next 100 NSE trading days (gated)
 *   onlinelkb.in/trading_rules      -> daily reading board (editor + large display)
 *   onlinelkb.in/api/trading_rules  -> JSON API for the board (gated)
 *   onlinelkb.in/img/*          -> gated image serving from Workers KV
 *
 *     any other path -> GitHub Pages origin (zone routes own only the above)
 *
 *   GET/POST /login blocked after LOCK_MAX bad attempts from one IP -> page
 *   closed for LOCK_MS (auto-opens again, no config change needed)
 *
 * Storage:
 *   D1 (env.DB): users (PBKDF2 hashes)
 *                + entries (note/date/image_key + images JSON key list)
 *                + login_failures (per-IP brute-force lockout)
 *   KV (env.MEDIA): uploaded image bytes, metadata.contentType
 *
 *   Each entry holds up to MAX_IMAGES images. entries.images stores the ordered
 *   KV keys as a JSON array; entries.image_key mirrors the first key so older
 *   clients (and pre-migration rows) keep working.
 *
 * Sessions are HMAC-signed cookies "username.expiryMs.signature".
 * Credentials/kv ids never live in this repo; see worker/schema.sql and
 * scripts/gen-admin-hash.mjs.
 *
 * Page markup lives in worker/src/pages/*.html, imported as text
 * (wrangler [[rules]] type=Text) and completed with {{TOKEN}} placeholders.
 */

import loginTemplate from "./pages/login.html";
import lockedTemplate from "./pages/locked.html";
import adminTemplate from "./pages/admin.html";
import tradeJournalTemplate from "./pages/trade_journal.html";
import tradingRulesTemplate from "./pages/trading_rules.html";
import { DEFAULT_NSE_DAYS, getNextTradingDays, nextMondayISO, toISODate } from "./trading_days.js";

const COOKIE = "lkb_session";
const TTL_MS = 24 * 60 * 60 * 1000; // 1 day while testing
const FALLBACK_SECRET = "local-dev-secret";
const USERNAME_RE = /^[A-Za-z0-9._-]{1,32}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const NOTE_MAX = 5000;
const MAX_IMG_BYTES = 15 * 1024 * 1024;
const MAX_IMAGES = 10;
// brute-force guard: LOCK_MAX bad logins from one IP inside ATTEMPT_WINDOW_MS
// close /login for LOCK_MS
const LOCK_MAX = 3;
const LOCK_MS = 15 * 60 * 1000;
const ATTEMPT_WINDOW_MS = 10 * 60 * 1000;

const encoder = new TextEncoder();

const b2h = (buf) =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

// constant-time comparisons so response timing leaks nothing
function bytesEqual(a, b) {
  return a.length === b.length && crypto.subtle.timingSafeEqual(a, b);
}

async function hmacHex(value, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return b2h(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}

async function hashPassword(password, saltHex) {
  const salt = Uint8Array.from(saltHex.match(/../g), (x) => parseInt(x, 16));
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: 100_000 },
    key,
    256,
  );
  return b2h(bits);
}

// cookie "username.expiryMs.hmac(username|expiryMs)" -> username or null
async function readSession(request, env) {
  const raw = (request.headers.get("Cookie") || "")
    .split("; ")
    .find((c) => c.startsWith(COOKIE + "="));
  if (!raw) return null;
  const parts = raw.slice(COOKIE.length + 1).split(".");
  if (parts.length !== 3) return null;
  const [userRaw, exp, sig] = parts;
  if (Number(exp) < Date.now()) return null;
  const username = decodeURIComponent(userRaw);
  const secret = env.SESSION_SECRET ?? FALLBACK_SECRET;
  if (!bytesEqual(encoder.encode(await hmacHex(`${username}|${exp}`, secret)), encoder.encode(sig))) {
    return null;
  }
  return username;
}

/* ---------------- auth ---------------- */

const clientIp = (request) => request.headers.get("CF-Connecting-IP") || "unknown";

// brute-force guard row for one IP. null when the table is missing or D1
// hiccups -> we fail open, so storage trouble can never brick the login page
async function loadGuardRow(env, ip) {
  try {
    return await env.DB
      .prepare("SELECT fails, locked_until, updated_at FROM login_failures WHERE ip = ?")
      .bind(ip)
      .first();
  } catch {
    return null;
  }
}

const lockRemaining = (row, now) =>
  row && Number(row.locked_until || 0) > now ? Number(row.locked_until) - now : 0;

// failed attempts that still count; older than ATTEMPT_WINDOW_MS start fresh
function freshFails(row, now) {
  if (!row || Number(row.updated_at || 0) < now - ATTEMPT_WINDOW_MS) return 0;
  return Math.max(0, Number(row.fails || 0));
}

// count one bad login from ip and engage the lock when the limit is hit
async function recordFailure(env, ip, row, now) {
  const fails = freshFails(row, now) + 1;
  if (fails >= LOCK_MAX) {
    // engage lock; also reset fails so the window restarts cleanly after it lifts
    await env.DB
      .prepare("UPDATE login_failures SET fails = 0, locked_until = ?, updated_at = ? WHERE ip = ?")
      .bind(now + LOCK_MS, now, ip)
      .run();
    return;
  }
  if (row) {
    await env.DB
      .prepare("UPDATE login_failures SET fails = ?, locked_until = 0, updated_at = ? WHERE ip = ?")
      .bind(fails, now, ip)
      .run();
  } else {
    await env.DB
      .prepare("INSERT INTO login_failures (ip, fails, locked_until, updated_at) VALUES (?, ?, 0, ?)")
      .bind(ip, fails, now)
      .run();
  }
}

async function handleLogin(request, env) {
  const form = await request.formData();
  const username = String(form.get("username") || "").trim();
  const password = String(form.get("password") || "");
  const { origin } = new URL(request.url);

  const ip = clientIp(request);
  const now = Date.now();
  const row = await loadGuardRow(env, ip);
  const lockedFor = lockRemaining(row, now);
  if (lockedFor > 0) return lockedPage(lockedFor);

  const validName = username && USERNAME_RE.test(username) ? username : null;
  if (validName && password) {
    try {
      const user = await env.DB
        .prepare("SELECT username, salt, password_hash FROM users WHERE username = ?")
        .bind(validName)
        .first();
      if (user) {
        const ok = bytesEqual(
          encoder.encode(await hashPassword(password, user.salt)),
          encoder.encode(user.password_hash),
        );
        if (ok) {
          // success wipes this IP's failed-attempt counter
          try {
            await env.DB.prepare("DELETE FROM login_failures WHERE ip = ?").bind(ip).run();
          } catch {
            // counter cleanup failing must not cost the user their session
          }
          const exp = Date.now() + TTL_MS;
          const sig = await hmacHex(`${validName}|${exp}`, env.SESSION_SECRET ?? FALLBACK_SECRET);
          return new Response(null, {
            status: 302,
            headers: {
              Location: `${origin}/hello`,
              "Set-Cookie": `${COOKIE}=${encodeURIComponent(validName)}.${exp}.${sig}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${TTL_MS / 1000}`,
            },
          });
        }
      }
    } catch {
      // D1 error or hashing failure -> treat as a failed login, never as success
    }
  }

  // wrong username, wrong password, or a malformed form: count the attempt
  try {
    await recordFailure(env, ip, row, now);
  } catch {
    // guard bookkeeping failing must not stop the login flow
  }
  return Response.redirect(`${origin}/login?error=1`, 303);
}

/* ---------------- entries API ---------------- */

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

function imageExt(name, type) {
  const base = String(name || "").split(/[\\/]/).pop();
  const m = /\.([a-z0-9]{1,5})$/i.exec(base);
  if (m) return m[1].toLowerCase().replace("jpeg", "jpg");
  const byType = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif", "image/avif": "avif" };
  return byType[type] || "bin";
}

// every non-empty file under the repeated `image` form field (supports both
// one file from older clients and many files from the multi-image composer)
const imageFiles = (form) =>
  form.getAll("image").filter((f) => f && typeof f === "object" && f.size > 0);

// `remove_images` is a JSON array of KV keys the client wants dropped
function removeImageKeys(form) {
  const raw = String(form.get("remove_images") || "");
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((k) => typeof k === "string" && k) : [];
  } catch {
    return [];
  }
}

// ordered image keys for a row, falling back to the legacy single-image column
function parseImageKeys(row) {
  let keys = [];
  if (row && row.images) {
    try {
      const parsed = JSON.parse(row.images);
      if (Array.isArray(parsed)) keys = parsed.filter((k) => typeof k === "string" && k);
    } catch {
      // corrupt/legacy JSON -> fall back to image_key below
    }
  }
  if (!keys.length && row && row.image_key) keys = [row.image_key];
  return [...new Set(keys)];
}

async function deleteImages(env, keys) {
  await Promise.all(keys.map((key) => env.MEDIA.delete(key).catch(() => {})));
}

// upload the files, rolling back already-written KV objects if one fails
async function storeImages(env, entryDate, files) {
  const keys = [];
  try {
    for (const file of files) {
      const key = `img-${entryDate}_${Date.now()}_${crypto.randomUUID().slice(0, 8)}.${imageExt(file.name, file.type)}`;
      await env.MEDIA.put(key, new Uint8Array(await file.arrayBuffer()), {
        metadata: { contentType: file.type || "application/octet-stream" },
      });
      keys.push(key);
    }
    return keys;
  } catch (err) {
    await deleteImages(env, keys);
    throw err;
  }
}

const tooManyImages = () => json({ ok: false, error: `Too many images (max ${MAX_IMAGES})` }, 400);
const tooLargeImage = () => json({ ok: false, error: "Image too large (max 15MB each)" }, 413);

// surface a missing migration clearly instead of a generic "Save failed"
const dbError = (err, fallback) =>
  /no such column/i.test(String(err && err.message))
    ? "Database migration missing — apply worker/migrations/0001_multiple_images.sql"
    : fallback;

async function handleEntryCreate(request, env) {
  try {
    const form = await request.formData();
    const entryDate = String(form.get("entry_date") || "").trim();
    const note = String(form.get("note") || "").trim().slice(0, NOTE_MAX);
    const files = imageFiles(form);

    if (!DATE_RE.test(entryDate)) return json({ ok: false, error: "Invalid date" }, 400);
    if (!note && !files.length) return json({ ok: false, error: "Add a note or an image" }, 400);
    if (files.length > MAX_IMAGES) return tooManyImages();
    if (files.some((f) => f.size > MAX_IMG_BYTES)) return tooLargeImage();

    let imageKeys = [];
    try {
      imageKeys = await storeImages(env, entryDate, files);
    } catch {
      return json({ ok: false, error: "Image upload failed" }, 500);
    }

    try {
      const res = await env.DB
        .prepare("INSERT INTO entries (entry_date, note, image_key, images) VALUES (?, ?, ?, ?)")
        .bind(entryDate, note, imageKeys[0] ?? null, JSON.stringify(imageKeys))
        .run();
      return json({
        ok: true,
        entry: {
          id: res.meta.last_row_id,
          entry_date: entryDate,
          note,
          image_key: imageKeys[0] ?? null,
          images: imageKeys,
        },
      });
    } catch (err) {
      await deleteImages(env, imageKeys); // DB unchanged, drop the uploaded blobs
      return json({ ok: false, error: dbError(err, "Save failed") }, 500);
    }
  } catch {
    return json({ ok: false, error: "Invalid form data" }, 400);
  }
}

/*
 * PUT semantics: entry_date + note are set; the image list is resolved as
 *   - image_action=remove -> remove every existing image (legacy full clear)
 *   - remove_images=[...] -> drop those specific keys
 *   - new `image` files   -> appended after the kept images
 *   - otherwise           -> existing images are kept as-is
 * Removed KV objects are deleted only after the D1 update commits.
 */
async function handleEntryUpdate(request, env) {
  try {
    const id = Number(new URL(request.url).pathname.split("/").pop());
    if (!Number.isInteger(id) || id <= 0) return json({ ok: false, error: "Bad id" }, 400);
    let row;
    try {
      row = await env.DB.prepare("SELECT image_key, images FROM entries WHERE id = ?").bind(id).first();
    } catch (err) {
      return json({ ok: false, error: dbError(err, "Could not load entry") }, 500);
    }
    if (!row) return json({ ok: false, error: "Not found" }, 404);

    const form = await request.formData();
    const entryDate = String(form.get("entry_date") || "").trim();
    const note = String(form.get("note") || "").trim().slice(0, NOTE_MAX);
    const imageAction = String(form.get("image_action") || "keep"); // "keep" | "remove"
    const files = imageFiles(form);

    if (!DATE_RE.test(entryDate)) return json({ ok: false, error: "Invalid date" }, 400);
    if (files.length > MAX_IMAGES) return tooManyImages();
    if (files.some((f) => f.size > MAX_IMG_BYTES)) return tooLargeImage();

    const current = parseImageKeys(row);
    const removeSet = new Set(removeImageKeys(form));
    const kept = imageAction === "remove" ? [] : current.filter((key) => !removeSet.has(key));
    if (kept.length + files.length > MAX_IMAGES) return tooManyImages();

    // never leave a completely empty entry behind (e.g. deleting the last
    // image of an image-only note) — delete the entry instead
    if (!note && kept.length + files.length === 0) {
      return json({ ok: false, error: "Add a note or an image (or delete the entry)" }, 400);
    }

    let newKeys = [];
    try {
      newKeys = await storeImages(env, entryDate, files);
    } catch {
      return json({ ok: false, error: "Image upload failed" }, 500);
    }

    const finalKeys = [...kept, ...newKeys];
    try {
      await env.DB
        .prepare("UPDATE entries SET entry_date = ?, note = ?, image_key = ?, images = ? WHERE id = ?")
        .bind(entryDate, note, finalKeys[0] ?? null, JSON.stringify(finalKeys), id)
        .run();
    } catch (err) {
      await deleteImages(env, newKeys); // DB unchanged, drop the new blobs
      return json({ ok: false, error: dbError(err, "Save failed") }, 500);
    }

    // DB committed: safe to delete the KV objects no longer referenced
    await deleteImages(env, current.filter((key) => !finalKeys.includes(key)));

    return json({
      ok: true,
      entry: {
        id,
        entry_date: entryDate,
        note,
        image_key: finalKeys[0] ?? null,
        images: finalKeys,
      },
    });
  } catch {
    return json({ ok: false, error: "Invalid form data" }, 400);
  }
}

async function handleEntryList(env) {
  try {
    const { results } = await env.DB
      .prepare("SELECT id, entry_date, note, image_key, images, created_at FROM entries ORDER BY entry_date DESC, id DESC LIMIT 200")
      .all();
    return json({ ok: true, entries: results.map((row) => ({ ...row, images: parseImageKeys(row) })) });
  } catch (err) {
    if (/no such column/i.test(String(err && err.message))) {
      // pre-migration DB: still serve rows using the single legacy image column
      const { results } = await env.DB
        .prepare("SELECT id, entry_date, note, image_key, created_at FROM entries ORDER BY entry_date DESC, id DESC LIMIT 200")
        .all();
      return json({ ok: true, entries: results.map((row) => ({ ...row, images: parseImageKeys(row) })) });
    }
    return json({ ok: false, error: "Could not load entries" }, 500);
  }
}

async function handleEntryDelete(request, env) {
  try {
    const id = Number(new URL(request.url).pathname.split("/").pop());
    if (!Number.isInteger(id) || id <= 0) return json({ ok: false, error: "Bad id" }, 400);
    let row;
    try {
      row = await env.DB.prepare("SELECT image_key, images FROM entries WHERE id = ?").bind(id).first();
    } catch {
      row = await env.DB.prepare("SELECT image_key FROM entries WHERE id = ?").bind(id).first();
    }
    if (!row) return json({ ok: false, error: "Not found" }, 404);
    await deleteImages(env, parseImageKeys(row));
    await env.DB.prepare("DELETE FROM entries WHERE id = ?").bind(id).run();
    return json({ ok: true });
  } catch {
    return json({ ok: false, error: "Delete failed" }, 500);
  }
}

async function serveImage(request, env) {
  const { pathname } = new URL(request.url);
  try {
    const key = decodeURIComponent(pathname.slice("/img/".length));
    const { value, metadata } = await env.MEDIA.getWithMetadata(key, { type: "stream" });
    if (!value) return new Response("Not found", { status: 404 });
    return new Response(value, {
      headers: {
        "Content-Type": (metadata && metadata.contentType) || "application/octet-stream",
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

// GET /api/trade_journal/calendar?from=YYYY-MM-DD — defaults to next Monday.
// The journal's Reset button uses this to refresh its 100-day schedule.
function handleTradingDaysCalendar(request) {
  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from");
  const start = from && DATE_RE.test(from) ? from : nextMondayISO(toISODate(new Date()));
  const { days } = getNextTradingDays(100, start);
  return json({ ok: true, start, days });
}

async function handleTradeJournalGet(request, env, username) {
  try {
    try {
      await env.DB.prepare(
        "CREATE TABLE IF NOT EXISTS trade_journal (user_id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)"
      ).run();
    } catch {}
    const row = await env.DB.prepare("SELECT data FROM trade_journal WHERE user_id = ?").bind(username).first();
    if (!row) return json({ ok: true, data: null });
    return json({ ok: true, data: JSON.parse(row.data) });
  } catch {
    return json({ ok: false, error: "Could not load journal" }, 500);
  }
}

async function handleTradeJournalSave(request, env, username) {
  try {
    const payload = await request.json();
    if (!payload || typeof payload !== "object") return json({ ok: false, error: "Invalid payload" }, 400);
    try {
      await env.DB.prepare(
        "CREATE TABLE IF NOT EXISTS trade_journal (user_id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)"
      ).run();
    } catch {}
    await env.DB.prepare(
      "INSERT INTO trade_journal (user_id, data, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = CURRENT_TIMESTAMP"
    ).bind(username, JSON.stringify(payload)).run();
    return json({ ok: true });
  } catch {
    return json({ ok: false, error: "Save failed" }, 500);
  }
}

/* ---------------- trading rules ---------------- */

const RULES_MAX = 20000;

async function handleTradingRulesGet(env, username) {
  try {
    try {
      await env.DB.prepare(
        "CREATE TABLE IF NOT EXISTS trading_rules (user_id TEXT PRIMARY KEY, text TEXT NOT NULL, rev INTEGER NOT NULL DEFAULT 0, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)"
      ).run();
    } catch {}
    const row = await env.DB.prepare("SELECT text, rev FROM trading_rules WHERE user_id = ?").bind(username).first();
    return json({ ok: true, text: row ? row.text : null, rev: row ? Number(row.rev) || 0 : 0 });
  } catch {
    return json({ ok: false, error: "Could not load rules" }, 500);
  }
}

async function handleTradingRulesSave(request, env, username) {
  try {
    const payload = await request.json();
    if (!payload || typeof payload.text !== "string") return json({ ok: false, error: "Invalid payload" }, 400);
    if (payload.text.length > RULES_MAX) return json({ ok: false, error: "Too much text" }, 413);
    const rev = Number.isFinite(Number(payload.rev)) ? Number(payload.rev) : Date.now();
    try {
      await env.DB.prepare(
        "CREATE TABLE IF NOT EXISTS trading_rules (user_id TEXT PRIMARY KEY, text TEXT NOT NULL, rev INTEGER NOT NULL DEFAULT 0, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)"
      ).run();
    } catch {}
    await env.DB.prepare(
      "INSERT INTO trading_rules (user_id, text, rev, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(user_id) DO UPDATE SET text = excluded.text, rev = excluded.rev, updated_at = CURRENT_TIMESTAMP"
    ).bind(username, payload.text, rev).run();
    return json({ ok: true, rev });
  } catch {
    return json({ ok: false, error: "Save failed" }, 500);
  }
}

/* ---------------- pages ---------------- */

const page = (body) =>
  new Response(body, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[c]));

// {{TOKEN}} substitution for the templates imported from ./pages/*.html.
// split/join rather than .replace so "$" in values can never act as a pattern.
const fill = (tpl, map) =>
  Object.entries(map).reduce((acc, [key, value]) => acc.split(`{{${key}}}`).join(String(value)), tpl);

const loginErrorHtml = (attemptsLeft) =>
  !Number.isFinite(attemptsLeft) || attemptsLeft <= 0
    ? ""
    : `<p style="margin:0;color:#f87171;font-size:14px">Invalid credentials. ${attemptsLeft} attempt${attemptsLeft === 1 ? "" : "s"} left before a 15-minute lock.</p>`;

const loginPage = (error, attemptsLeft) =>
  page(fill(loginTemplate, { ERROR: error ? loginErrorHtml(attemptsLeft) : "" }));



const lockedPage = (remainMs) => {
  const mins = Math.max(1, Math.ceil(remainMs / 60000));
  return page(fill(lockedTemplate, { MINUTES: String(mins), S: mins === 1 ? "" : "s" }));
};

const adminPage = (username) =>
  page(fill(adminTemplate, { USERNAME: esc(username) }));

const tradeJournalPage = (username) =>
  page(fill(tradeJournalTemplate, {
    USERNAME: esc(username),
    NSE_DAYS_JSON: JSON.stringify(DEFAULT_NSE_DAYS),
  }));

const tradingRulesPage = (username) =>
  page(fill(tradingRulesTemplate, { USERNAME: esc(username) }));


/* ---------------- router ---------------- */

export default {
  async fetch(request, env) {
    const { pathname, origin, searchParams } = new URL(request.url);

    if (pathname === "/login") {
      if (request.method === "POST") return handleLogin(request, env);
      const row = await loadGuardRow(env, clientIp(request));
      const now = Date.now();
      if (lockRemaining(row, now) > 0) return lockedPage(lockRemaining(row, now));
      return loginPage(searchParams.get("error") === "1", LOCK_MAX - freshFails(row, now));
    }

    if (pathname === "/logout") {
      return new Response(null, {
        status: 302,
        headers: {
          Location: `${origin}/`,
          "Set-Cookie": `${COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`,
        },
      });
    }

    // gated area ------------------------------------------------------------
    if (pathname === "/hello") {
      const username = await readSession(request, env);
      return username ? adminPage(username) : Response.redirect(`${origin}/login`, 302);
    }

    if (pathname === "/trade_journal" || pathname === "/trade_journal/") {
      const username = await readSession(request, env);
      return username ? tradeJournalPage(username) : Response.redirect(`${origin}/login`, 302);
    }

    if (pathname === "/api/trade_journal/calendar") {
      const session = await readSession(request, env);
      if (!session) return json({ ok: false, error: "Unauthorized" }, 401);
      if (request.method !== "GET") return json({ ok: false, error: "Method not allowed" }, 405);
      return handleTradingDaysCalendar(request);
    }

    if (pathname === "/api/trade_journal" || pathname.startsWith("/api/trade_journal/")) {
      const session = await readSession(request, env);
      if (!session) return json({ ok: false, error: "Unauthorized" }, 401);
      if (request.method === "GET") return handleTradeJournalGet(request, env, session);
      if (request.method === "POST") return handleTradeJournalSave(request, env, session);
      return json({ ok: false, error: "Method not allowed" }, 405);
    }

    if (pathname === "/trading_rules" || pathname === "/trading_rules/") {
      const username = await readSession(request, env);
      return username ? tradingRulesPage(username) : Response.redirect(`${origin}/login`, 302);
    }

    if (pathname === "/api/trading_rules" || pathname === "/api/trading_rules/") {
      const session = await readSession(request, env);
      if (!session) return json({ ok: false, error: "Unauthorized" }, 401);
      if (request.method === "GET") return handleTradingRulesGet(env, session);
      if (request.method === "POST") return handleTradingRulesSave(request, env, session);
      return json({ ok: false, error: "Method not allowed" }, 405);
    }

    if (pathname === "/api/entries" || pathname.startsWith("/api/entries/")) {
      const session = await readSession(request, env);
      if (!session) return json({ ok: false, error: "Unauthorized" }, 401);
      if (request.method === "POST") return handleEntryCreate(request, env);
      if (request.method === "PUT") return handleEntryUpdate(request, env);
      if (request.method === "GET") return handleEntryList(env);
      if (request.method === "DELETE") return handleEntryDelete(request, env);
      return json({ ok: false, error: "Method not allowed" }, 405);
    }

    if (pathname.startsWith("/img/")) {
      const session = await readSession(request, env);
      if (!session) return Response.redirect(`${origin}/login`, 302);
      return serveImage(request, env);
    }

    // Catch-all: staging serves static assets via env.ASSETS; the live deployment
    // passes through to the origin (GitHub Pages).
    return env.ASSETS ? env.ASSETS.fetch(request) : fetch(request);
  },
};
