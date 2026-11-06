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
 */

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

const loginPage = (error, attemptsLeft) => page(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Sign in · onlinelkb.in</title>
</head>
<body style="margin:0;font-family:system-ui,sans-serif;background:#0f172a;display:grid;place-items:center;min-height:100vh">
  <form method="post" action="/login" style="background:#1e293b;color:#e2e8f0;padding:32px;border-radius:12px;display:grid;gap:12px;min-width:280px">
    <h2 style="margin:0;font-weight:600">Private area</h2>
    ${error ? `<p style="margin:0;color:#f87171;font-size:14px">Invalid credentials.${Number.isFinite(attemptsLeft) && attemptsLeft > 0 ? " " + attemptsLeft + " attempt" + (attemptsLeft === 1 ? "" : "s") + " left before a 15-minute lock." : ""}</p>` : ""}
    <input name="username" placeholder="Username" required autofocus
      style="padding:8px 10px;border-radius:8px;border:1px solid #475569;background:#0f172a;color:#e2e8f0" />
    <input name="password" type="password" placeholder="Password" required
      style="padding:8px 10px;border-radius:8px;border:1px solid #475569;background:#0f172a;color:#e2e8f0" />
    <button style="padding:10px;border-radius:8px;border:0;background:#38bdf8;color:#0f172a;font-weight:600;cursor:pointer">Sign in</button>
  </form>
</body>
</html>`);

const lockedPage = (remainMs) => {
  const mins = Math.max(1, Math.ceil(remainMs / 60000));
  return page(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta http-equiv="refresh" content="45" />
  <title>Temporarily locked · onlinelkb.in</title>
</head>
<body style="margin:0;font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;display:grid;place-items:center;min-height:100vh">
  <div style="background:#1e293b;padding:32px;border-radius:12px;max-width:360px">
    <h2 style="margin:0 0 10px;font-weight:600">🔒 Too many failed attempts</h2>
    <p style="margin:0;color:#cbd5e1;font-size:14px;line-height:1.6">Sign-in is closed for about <strong style="color:#f87171">${mins} minute${mins === 1 ? "" : "s"}</strong> after repeated failed logins from your network.</p>
    <p style="margin:12px 0 0;color:#94a3b8;font-size:12px">This page refreshes itself every 45 seconds — no need to reopen anything.</p>
  </div>
</body>
</html>`);
};

const adminPage = (username) => page(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta name="robots" content="noindex" />
  <title>Private tools · onlinelkb.in</title>
  <style>
    body { margin:0; font-family:system-ui,sans-serif; background:#0f172a; color:#e2e8f0; padding:28px 16px 56px; }
    .app { max-width:1180px; margin:0 auto; }
    .topbar { display:flex; align-items:center; gap:14px; flex-wrap:wrap;
              background:#1e293b; border-radius:12px; padding:10px 16px; margin-bottom:20px; }
    .topbar .brand { font-size:18px; font-weight:600; margin:0; }
    .topbar .tab { padding:8px 18px; font-size:13px; }
    .who { margin-left:auto; font-size:13px; color:#94a3b8; }
    .who strong { color:#e2e8f0; font-weight:600; }
    .who a { color:#f87171; text-decoration:none; }
    .who a:hover { text-decoration:underline; }
    .tab { background:#1e293b; border:1px solid #475569; color:#94a3b8; padding:10px 24px;
           border-radius:999px; font-size:14px; cursor:pointer; font-family:inherit; }
    .tab:hover { color:#e2e8f0; }
    .tab.active { background:#38bdf8; border-color:#38bdf8; color:#0f172a; font-weight:600; }
    .panel { background:#1e293b; border-radius:14px; padding:20px; }
    .panel h2 { font-size:13px; letter-spacing:.08em; text-transform:uppercase; color:#94a3b8; margin:0 0 16px; }
    .narrow { max-width:640px; margin:0 auto; }
    .fields { display:grid; gap:12px; }
    label { font-size:13px; color:#cbd5e1; display:grid; gap:4px; }
    input, textarea { padding:8px 10px; border-radius:8px; border:1px solid #475569;
                      background:#0f172a; color:#e2e8f0; font:inherit; font-size:14px; width:100%; box-sizing:border-box; }
    textarea { min-height:150px; resize:vertical; line-height:1.5; }
    button.primary { padding:10px 14px; border-radius:8px; border:0; background:#38bdf8; color:#0f172a;
                     font-weight:600; cursor:pointer; }
    #cancel-edit { padding:10px 12px; border-radius:8px; border:1px solid #475569;
                   background:transparent; color:#cbd5e1; cursor:pointer; }
    .remove-tick { display:flex; align-items:center; gap:8px; font-size:13px; color:#cbd5e1; }
    .remove-tick input { width:auto; }
    .hint { color:#64748b; font-size:12px; margin:4px 0 0; }
    #status { font-size:14px; min-height:1.2em; margin:12px 0 0; color:#94a3b8; text-align:center; }
    .pending { border:1px dashed #475569; border-radius:12px; padding:16px; background:#1e293b; }
    .badge { display:inline-block; font-size:11px; color:#64748b; border:1px solid #334155;
             padding:2px 8px; border-radius:999px; margin-bottom:10px; }
    .pending-date { font-size:13px; font-weight:600; color:#cbd5e1; }
    .pending-note { white-space:pre-wrap; margin:8px 0 0; font-size:15px; line-height:1.5; overflow-wrap:break-word; }
    .pending-frame { margin:12px 0 0; }
    .pending-frame img { display:block; max-width:100%; max-height:320px; border-radius:8px; margin:0 auto; }
    .notes-layout { display:grid; grid-template-columns:320px minmax(0,1fr); gap:20px; align-items:start; }
    .note-list { display:grid; gap:8px; max-height:calc(100vh - 240px); overflow-y:auto;
                 padding-right:4px; margin:0; padding-top:2px; }
    .note-item { text-align:left; background:#263449; border:1px solid transparent; border-radius:10px;
                 padding:12px 14px; cursor:pointer; display:grid; gap:4px; font-family:inherit; width:100%; }
    .note-item:hover { border-color:#334155; }
    .note-item.active { border-color:#38bdf8; }
    .note-item .nd { font-size:12px; color:#94a3b8; }
    .note-item .ns { font-size:14px; color:#e2e8f0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .detail-head { display:flex; justify-content:space-between; align-items:center; gap:12px;
                   border-bottom:1px solid #334155; padding-bottom:12px; margin-bottom:14px; }
    .detail-date { font-size:16px; font-weight:600; color:#e2e8f0; }
    .detail-actions { display:flex; gap:10px; }
    .detail-date-note { }
    .detail-note { white-space:pre-wrap; font-size:16px; line-height:1.65; margin:0 0 16px; overflow-wrap:break-word; }
    .detail-note.muted { color:#64748b; font-size:14px; }
    .detail-img { display:block; max-width:100%; max-height:560px; border-radius:10px; cursor:zoom-in; margin:0 auto; }
    .zoomhint { color:#64748b; font-size:12px; margin:10px 0 0; text-align:center; }
    .entry-edit { background:none; border:0; color:#38bdf8; font-size:13px; cursor:pointer; padding:2px 6px; }
    .entry-del { background:none; border:0; color:#f87171; font-size:13px; cursor:pointer; padding:2px 6px; }
    .muted { color:#64748b; }
    #lightbox { position:fixed; inset:0; background:rgba(2,6,23,.94); z-index:50;
                display:grid; place-items:center; cursor:zoom-out; }
    #lightbox img { max-width:94vw; max-height:86vh; width:auto; height:auto; object-fit:contain;
                    border-radius:6px; box-shadow:0 12px 48px rgba(0,0,0,.65); }
    .lightbar { position:fixed; bottom:18px; left:0; right:0; display:flex; gap:16px; justify-content:center;
                font-size:13px; color:#cbd5e1; }
    .lightbar a { color:#38bdf8; text-decoration:none; }
    [hidden] { display:none !important; }
    @media (max-width:880px) {
      .topbar { gap:8px; padding:8px 12px; }
      .topbar .brand { font-size:16px; }
      .notes-layout { grid-template-columns:1fr; }
      .note-list { max-height:44vh; }
    }
  </style>
</head>
<body>
  <div class="app">
    <header class="topbar">
      <h1 class="brand">Private tools</h1>
      <nav class="tabs" role="tablist" aria-label="Private tools sections">
        <button type="button" class="tab active" id="tab-compose" role="tab" aria-selected="true">＋ New entry</button>
        <button type="button" class="tab" id="tab-notes" role="tab" aria-selected="false">My notes</button>
      </nav>
      <span class="who">Signed in as <strong>${username}</strong> 👋 · <a href="/logout">log out</a></span>
    </header>

    <section id="view-compose">
      <div class="panel narrow" id="composer-panel">
        <h2>New entry</h2>
        <form id="entry-form" class="fields">
          <label>Date
            <input id="entry_date" name="entry_date" type="date" required />
          </label>
          <label>Note
            <textarea id="note" name="note" maxlength="5000" placeholder="Write something…"></textarea>
          </label>
          <label>Image (optional, max 15MB)
            <input id="image" name="image" type="file" accept="image/*" />
          </label>
          <label class="remove-tick" id="remove-image-row" hidden>
            <input id="remove-image" type="checkbox" />
            remove the existing image
          </label>
          <button class="primary" id="submit-btn" type="submit">Save entry</button>
          <button type="button" id="cancel-edit" hidden>Cancel</button>
          <p class="hint" id="edit-hint" hidden>You are editing a saved note — saving replaces it.</p>
          <p class="hint">Pick a past date to backdate, or leave as today.</p>
        </form>
        <p id="status" aria-live="polite"></p>
      </div>
      <div class="pending narrow" id="pending" hidden>
        <span class="badge">preview — not saved yet</span>
        <div class="pending-date" id="pending-date"></div>
        <p class="pending-note" id="pending-note"></p>
        <div class="pending-frame" id="pending-frame" hidden>
          <img id="pending-img" alt="preview of selected image" />
        </div>
      </div>
    </section>

    <section id="view-notes" hidden>
      <div class="notes-layout">
        <div class="panel">
          <h2 id="list-title">List</h2>
          <div class="note-list" id="note-list" role="listbox" aria-label="Saved notes"></div>
        </div>
        <div class="panel" id="note-detail"></div>
      </div>
    </section>
  </div>

  <div id="lightbox" hidden>
    <img id="lightbox-img" alt="full size image" />
    <div class="lightbar">
      <span id="lightbox-date"></span>
      <a id="lightbox-original" href="#" target="_blank" rel="noopener noreferrer">open original ↗</a>
      <span>click anywhere or press Esc to close</span>
    </div>
  </div>

  <script>
    (function () {
      var $ = function (id) { return document.getElementById(id); };
      var esc = function (s) {
        return String(s).replace(/[&<>"']/g, function (c) {
          return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
        });
      };
      var now = new Date();
      var today = now.getFullYear() + "-" +
        String(now.getMonth() + 1).padStart(2, "0") + "-" +
        String(now.getDate()).padStart(2, "0");

      var dateEl = $("entry_date"), noteEl = $("note"), fileEl = $("image");
      var pend = $("pending"), pendDate = $("pending-date"), pendNote = $("pending-note");
      var pendFrame = $("pending-frame"), pendImg = $("pending-img");
      var lightbox = $("lightbox"), lightImg = $("lightbox-img"), lightDate = $("lightbox-date");
      var lightOriginal = $("lightbox-original");
      var pendBadge = pend.querySelector(".badge");
      var submitBtn = $("submit-btn"), cancelBtn = $("cancel-edit");
      var removeRow = $("remove-image-row"), removeChk = $("remove-image");
      var editingId = null, baseImageKey = null;
      var ENTRIES = [];
      var selectedId = null;
      dateEl.value = today;

      /* ---------- tabs ---------- */
      function setTab(name) {
        $("view-compose").hidden = name !== "compose";
        $("view-notes").hidden = name !== "notes";
        $("tab-compose").classList.toggle("active", name === "compose");
        $("tab-notes").classList.toggle("active", name === "notes");
        $("tab-compose").setAttribute("aria-selected", name === "compose" ? "true" : "false");
        $("tab-notes").setAttribute("aria-selected", name === "notes" ? "true" : "false");
      }
      $("tab-compose").addEventListener("click", function () { setTab("compose"); });
      $("tab-notes").addEventListener("click", function () { setTab("notes"); });

      /* ---------- pending preview (compose tab) ---------- */
      var objectUrl = null;
      function updatePending() {
        var d = dateEl.value, n = noteEl.value.trim();
        var f = fileEl.files && fileEl.files[0];
        if (f && removeChk.checked) removeChk.checked = false; // picking a file means replace, not remove
        removeRow.hidden = !(editingId && baseImageKey && !f);
        pendBadge.textContent = "preview — " + (editingId ? "editing saved note" : "not saved yet");
        var show = (!!n) || (!!f) || d !== today;
        pend.hidden = !show;
        if (!show) return;
        pendDate.textContent = "📅 " + d;
        var removing = !!(editingId && removeChk.checked && baseImageKey && !f);
        pendNote.textContent = n || (removing ? "(note empty — image will be removed)" : "(no note — image only)");
        if (f) {
          if (objectUrl) URL.revokeObjectURL(objectUrl);
          objectUrl = URL.createObjectURL(f);
          pendImg.src = objectUrl;
          pendFrame.hidden = false;
        } else {
          pendImg.removeAttribute("src");
          pendFrame.hidden = true;
        }
      }
      noteEl.addEventListener("input", updatePending);
      dateEl.addEventListener("input", updatePending);
      fileEl.addEventListener("change", updatePending);

      function exitEdit() {
        editingId = null;
        baseImageKey = null;
        submitBtn.textContent = "Save entry";
        cancelBtn.hidden = true;
        removeRow.hidden = true;
        removeChk.checked = false;
        $("edit-hint").hidden = true;
      }

      function startEdit(entry) {
        editingId = Number(entry.id);
        baseImageKey = entry.image_key || null;
        fileEl.value = "";
        removeChk.checked = false;
        dateEl.value = entry.entry_date;
        noteEl.value = entry.note || "";
        submitBtn.textContent = "Update entry";
        cancelBtn.hidden = false;
        $("edit-hint").hidden = false;
        updatePending();
        setTab("compose");
        window.scrollTo({ top: 0 });
        noteEl.focus();
      }

      function resetComposer() {
        noteEl.value = "";
        fileEl.value = "";
        dateEl.value = today;
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        objectUrl = null;
        updatePending();
      }

      cancelBtn.addEventListener("click", function () {
        exitEdit();
        resetComposer();
      });

      /* ---------- save (create or update) ---------- */
      $("entry-form").addEventListener("submit", function (e) {
        e.preventDefault();
        var status = $("status");
        status.textContent = "Saving…";
        var fd = new FormData();
        fd.append("entry_date", dateEl.value);
        fd.append("note", noteEl.value);
        if (fileEl.files && fileEl.files[0]) fd.append("image", fileEl.files[0]);
        fd.append("image_action", editingId && !fileEl.files[0] && removeChk.checked ? "remove" : "keep");
        var url = editingId ? "/api/entries/" + editingId : "/api/entries";
        var savedId = editingId;
        fetch(url, { method: editingId ? "PUT" : "POST", body: fd })
          .then(function (res) {
            return res.json().then(function (d) { return { s: res.status, d: d }; });
          })
          .then(function (r) {
            if (r.s !== 200 || !r.d.ok) throw new Error(r.d.error || "Save failed");
            status.textContent = "Saved ✓";
            if (!editingId && r.d.entry && r.d.entry.id) savedId = r.d.entry.id;
            exitEdit();
            resetComposer();
            return loadEntries().then(function () {
              setTab("notes");
              selectNote(savedId);
            });
          })
          .catch(function (err) { status.textContent = err.message || "Save failed"; });
      });

      /* ---------- notes master-detail list ---------- */
      function itemHtml(e) {
        var snippet = (e.note || "(no note — image only)").replace(/\\s+/g, " ").slice(0, 80);
        return '<button type="button" class="note-item" role="option" data-id="' + esc(e.id) + '" aria-selected="false">' +
          '<span class="nd">📅 ' + esc(e.entry_date) + (e.image_key ? " · 📎 image" : "") + "</span>" +
          '<span class="ns">' + esc(snippet) + "</span>" +
          "</button>";
      }

      function renderList() {
        var items = ENTRIES;
        $("list-title").textContent = "List (" + items.length + ")";
        $("tab-notes").textContent = "My notes (" + items.length + ")";
        $("note-list").innerHTML = items.length
          ? items.map(itemHtml).join("")
          : '<div class="muted" style="font-size:14px">No notes yet — create one from the New entry tab.</div>';
        highlightSelection();
      }

      function highlightSelection() {
        var nodes = $("note-list").querySelectorAll(".note-item");
        for (var i = 0; i < nodes.length; i++) {
          var on = Number(nodes[i].getAttribute("data-id")) === Number(selectedId);
          nodes[i].classList.toggle("active", on);
          nodes[i].setAttribute("aria-selected", on ? "true" : "false");
        }
      }

      function detailHtml(e) {
        var h = '<div class="detail-head">' +
          '<span class="detail-date">📅 ' + esc(e.entry_date) + "</span>" +
          '<span class="detail-actions">' +
            '<button type="button" class="entry-edit" data-edit="' + esc(e.id) + '">edit</button>' +
            '<button type="button" class="entry-del" data-del="' + esc(e.id) + '">delete</button>' +
          "</span></div>";
        h += e.note
          ? '<div class="detail-note">' + esc(e.note).replace(/\\n/g, "<br>") + "</div>"
          : '<div class="detail-note muted">(no note — image only)</div>';
        if (e.image_key) {
          h += '<img class="detail-img" data-key="' + esc(e.image_key) + '" data-date="' + esc(e.entry_date) +
            '" src="/img/' + encodeURIComponent(e.image_key) + '" alt="note image">' +
            '<p class="zoomhint">click image to view full size</p>';
        }
        return h;
      }

      function selectNote(id) {
        if (id === undefined || id === null) return renderDetailEmpty();
        selectedId = Number(id);
        highlightSelection();
        var e = ENTRIES.filter(function (x) { return Number(x.id) === selectedId; })[0];
        $("note-detail").innerHTML = e ? detailHtml(e) : '<p class="viewer-note muted">Note not found.</p>';
        return null;
      }
      function renderDetailEmpty() {
        selectedId = null;
        $("note-detail").innerHTML = '<p class="detail-note muted">No note selected.</p>';
      }

      function loadEntries() {
        $("status").textContent = "";
        return fetch("/api/entries")
          .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error("load failed")); })
          .then(function (data) {
            ENTRIES = (data && data.entries) || [];
            renderList();
            if (selectedId === null || !ENTRIES.some(function (x) { return Number(x.id) === Number(selectedId); })) {
              selectNote(ENTRIES.length ? ENTRIES[0].id : null);
            } else {
              selectNote(selectedId); // refresh detail with fresh data
            }
          })
          .catch(function () {
            $("note-list").innerHTML = '<div class="muted" style="font-size:14px">Could not load notes.</div>';
          });
      }

      /* ---------- list + detail events ---------- */
      $("note-list").addEventListener("click", function (e) {
        var item = e.target.closest("[data-id]");
        if (item) selectNote(item.getAttribute("data-id"));
      });

      $("note-detail").addEventListener("click", function (e) {
        var img = e.target.closest("[data-key]");
        if (img) {
          openLightbox(img.getAttribute("data-key"), img.getAttribute("data-date"));
          return;
        }
        var editBtn = e.target.closest("[data-edit]");
        if (editBtn) {
          var target = ENTRIES.filter(function (x) {
            return Number(x.id) === Number(editBtn.getAttribute("data-edit"));
          })[0];
          if (target) startEdit(target);
          return;
        }
        var btn = e.target.closest("[data-del]");
        if (!btn) return;
        if (!confirm("Delete this note?")) return;
        fetch("/api/entries/" + btn.getAttribute("data-del"), { method: "DELETE" })
          .then(function (res) { return res.ok ? loadEntries() : null; });
      });

      /* ---------- lightbox ---------- */
      function openLightbox(key, date) {
        var url = "/img/" + encodeURIComponent(key);
        lightImg.src = url;
        lightDate.textContent = "📅 " + date;
        lightOriginal.href = url;
        lightbox.hidden = false;
        document.body.style.overflow = "hidden";
      }
      function closeLightbox() {
        lightbox.hidden = true;
        lightImg.removeAttribute("src");
        lightOriginal.removeAttribute("href");
        document.body.style.overflow = "";
      }
      lightbox.addEventListener("click", closeLightbox);
      document.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && !lightbox.hidden) closeLightbox();
      });

      loadEntries();
    })();
  </script>
</body>
</html>`);

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
