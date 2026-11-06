/**
 * Standalone Cloudflare Worker for onlinelkb.in — private admin tool.
 *
 * Attached routes (see wrangler.toml):
 *   onlinelkb.in/login          -> login form + D1 credential check
 *   onlinelkb.in/hello          -> gated admin app
 *                                 nav: [New entry] [My notes]
 *                                 My notes = master-detail: list left, selected
 *                                 note's text + image on the right
 *   onlinelkb.in/logout         -> clears session
 *   onlinelkb.in/api/entries*   -> JSON API (list/create/update/delete, gated)
 *   onlinelkb.in/img/*          -> gated image serving from Workers KV
 *
 *     any other path -> GitHub Pages origin (zone routes own only the above)
 *
 *   GET/POST /login blocked after LOCK_MAX bad attempts from one IP -> page
 *   closed for LOCK_MS (auto-opens again, no config change needed)
 *
 * Storage:
 *   D1 (env.DB): users (PBKDF2 hashes) + entries (note/date/image_key)
 *                + login_failures (per-IP brute-force lockout)
 *   KV (env.MEDIA): uploaded image bytes, metadata.contentType
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

const COOKIE = "lkb_session";
const TTL_MS = 24 * 60 * 60 * 1000; // 1 day while testing
const FALLBACK_SECRET = "local-dev-secret";
const USERNAME_RE = /^[A-Za-z0-9._-]{1,32}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const NOTE_MAX = 5000;
const MAX_IMG_BYTES = 15 * 1024 * 1024;
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

async function handleEntryCreate(request, env) {
  try {
    const form = await request.formData();
    const entryDate = String(form.get("entry_date") || "").trim();
    const note = String(form.get("note") || "").trim().slice(0, NOTE_MAX);
    const file = form.get("image");
    const hasImage = file && typeof file === "object" && file.size > 0;

    if (!DATE_RE.test(entryDate)) return json({ ok: false, error: "Invalid date" }, 400);
    if (!note && !hasImage) return json({ ok: false, error: "Add a note or an image" }, 400);
    if (hasImage && file.size > MAX_IMG_BYTES) return json({ ok: false, error: "Image too large (max 15MB)" }, 413);

    let imageKey = null;
    if (hasImage) {
      imageKey = `img-${entryDate}_${Date.now()}_${crypto.randomUUID().slice(0, 8)}.${imageExt(file.name, file.type)}`;
      try {
        await env.MEDIA.put(imageKey, new Uint8Array(await file.arrayBuffer()), {
          metadata: { contentType: file.type || "application/octet-stream" },
        });
      } catch (err) {
        await env.MEDIA.delete(imageKey).catch(() => {});
        return json({ ok: false, error: "Image upload failed" }, 500);
      }
    }

    try {
      const res = await env.DB
        .prepare("INSERT INTO entries (entry_date, note, image_key) VALUES (?, ?, ?)")
        .bind(entryDate, note, imageKey)
        .run();
      return json({
        ok: true,
        entry: { id: res.meta.last_row_id, entry_date: entryDate, note, image_key: imageKey },
      });
    } catch (err) {
      if (imageKey) await env.MEDIA.delete(imageKey).catch(() => {}); // avoid orphan blobs
      return json({ ok: false, error: "Save failed" }, 500);
    }
  } catch {
    return json({ ok: false, error: "Invalid form data" }, 400);
  }
}

/*
 * PUT semantics: entry_date + note are set; image resolved as
 *   - new file provided  -> replace (new KV object, old one deleted after success)
 *   - image_action=remove -> image_key NULL + KV object deleted
 *   - otherwise          -> keep existing image
 */
async function handleEntryUpdate(request, env) {
  try {
    const id = Number(new URL(request.url).pathname.split("/").pop());
    if (!Number.isInteger(id) || id <= 0) return json({ ok: false, error: "Bad id" }, 400);
    const row = await env.DB.prepare("SELECT image_key FROM entries WHERE id = ?").bind(id).first();
    if (!row) return json({ ok: false, error: "Not found" }, 404);

    const form = await request.formData();
    const entryDate = String(form.get("entry_date") || "").trim();
    const note = String(form.get("note") || "").trim().slice(0, NOTE_MAX);
    const imageAction = String(form.get("image_action") || "keep"); // "keep" | "remove"
    const file = form.get("image");
    const hasNewImage = file && typeof file === "object" && file.size > 0;

    if (!DATE_RE.test(entryDate)) return json({ ok: false, error: "Invalid date" }, 400);
    if (hasNewImage && file.size > MAX_IMG_BYTES) return json({ ok: false, error: "Image too large (max 15MB)" }, 413);

    const removingImage = imageAction === "remove" && row.image_key;
    if (!note && !hasNewImage && !removingImage && !row.image_key) {
      return json({ ok: false, error: "Add a note or an image" }, 400);
    }

    let oldKey = row.image_key;
    let newKey = row.image_key;
    if (imageAction === "remove" && !hasNewImage) newKey = null;

    if (hasNewImage) {
      newKey = `img-${entryDate}_${Date.now()}_${crypto.randomUUID().slice(0, 8)}.${imageExt(file.name, file.type)}`;
      try {
        await env.MEDIA.put(newKey, new Uint8Array(await file.arrayBuffer()), {
          metadata: { contentType: file.type || "application/octet-stream" },
        });
      } catch (err) {
        await env.MEDIA.delete(newKey).catch(() => {});
        return json({ ok: false, error: "Image upload failed" }, 500);
      }
    }

    try {
      await env.DB
        .prepare("UPDATE entries SET entry_date = ?, note = ?, image_key = ? WHERE id = ?")
        .bind(entryDate, note, newKey, id)
        .run();
    } catch (err) {
      if (hasNewImage) await env.MEDIA.delete(newKey).catch(() => {}); // DB unchanged, drop the new blob
      return json({ ok: false, error: "Save failed" }, 500);
    }

    // DB committed: safe to delete the replaced KV object now
    if (oldKey && oldKey !== newKey) await env.MEDIA.delete(oldKey).catch(() => {});

    return json({ ok: true, entry: { id: id, entry_date: entryDate, note: note, image_key: newKey } });
  } catch {
    return json({ ok: false, error: "Invalid form data" }, 400);
  }
}

async function handleEntryList(env) {
  try {
    const { results } = await env.DB
      .prepare("SELECT id, entry_date, note, image_key, created_at FROM entries ORDER BY entry_date DESC, id DESC LIMIT 200")
      .all();
    return json({ ok: true, entries: results });
  } catch {
    return json({ ok: false, error: "Could not load entries" }, 500);
  }
}

async function handleEntryDelete(request, env) {
  try {
    const id = Number(new URL(request.url).pathname.split("/").pop());
    if (!Number.isInteger(id) || id <= 0) return json({ ok: false, error: "Bad id" }, 400);
    const row = await env.DB.prepare("SELECT image_key FROM entries WHERE id = ?").bind(id).first();
    if (!row) return json({ ok: false, error: "Not found" }, 404);
    if (row.image_key) await env.MEDIA.delete(row.image_key).catch(() => {});
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
