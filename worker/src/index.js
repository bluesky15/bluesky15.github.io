/**
 * Standalone Cloudflare Worker for onlinelkb.in — private admin tool.
 *
 * Attached routes (see wrangler.toml):
 *   onlinelkb.in/login          -> login form + D1 credential check
 *   onlinelkb.in/hello          -> gated admin app: notes + image upload + selectable date
 *   onlinelkb.in/logout         -> clears session
 *   onlinelkb.in/api/entries*   -> JSON API (list/create/delete entries, gated)
 *   onlinelkb.in/img/*          -> gated image serving from Workers KV
 *
 *     any other path -> GitHub Pages origin (zone routes own only the above)
 *
 * Storage:
 *   D1 (env.DB): users (PBKDF2 hashes) + entries (note/date/image_key)
 *   KV (env.MEDIA): uploaded image bytes, key metadata.contentType
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

async function handleLogin(request, env) {
  const form = await request.formData();
  const username = String(form.get("username") || "").trim();
  const password = String(form.get("password") || "");
  const { origin } = new URL(request.url);

  if (username && USERNAME_RE.test(username) && password) {
    try {
      const user = await env.DB
        .prepare("SELECT username, salt, password_hash FROM users WHERE username = ?")
        .bind(username)
        .first();
      if (user) {
        const ok = bytesEqual(
          encoder.encode(await hashPassword(password, user.salt)),
          encoder.encode(user.password_hash),
        );
        if (ok) {
          const exp = Date.now() + TTL_MS;
          const sig = await hmacHex(`${username}|${exp}`, env.SESSION_SECRET ?? FALLBACK_SECRET);
          return new Response(null, {
            status: 302,
            headers: {
              Location: `${origin}/hello`,
              "Set-Cookie": `${COOKIE}=${encodeURIComponent(username)}.${exp}.${sig}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${TTL_MS / 1000}`,
            },
          });
        }
      }
    } catch {
      // D1 error or hashing failure -> treat as a failed login, never as success
    }
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

const loginPage = (error) => page(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Sign in · onlinelkb.in</title>
</head>
<body style="margin:0;font-family:system-ui,sans-serif;background:#0f172a;display:grid;place-items:center;min-height:100vh">
  <form method="post" action="/login" style="background:#1e293b;color:#e2e8f0;padding:32px;border-radius:12px;display:grid;gap:12px;min-width:280px">
    <h2 style="margin:0;font-weight:600">Private area</h2>
    ${error ? '<p style="margin:0;color:#f87171;font-size:14px">Invalid credentials — try again.</p>' : ""}
    <input name="username" placeholder="Username" required autofocus
      style="padding:8px 10px;border-radius:8px;border:1px solid #475569;background:#0f172a;color:#e2e8f0" />
    <input name="password" type="password" placeholder="Password" required
      style="padding:8px 10px;border-radius:8px;border:1px solid #475569;background:#0f172a;color:#e2e8f0" />
    <button style="padding:10px;border-radius:8px;border:0;background:#38bdf8;color:#0f172a;font-weight:600;cursor:pointer">Sign in</button>
  </form>
</body>
</html>`);

const adminPage = (username) => page(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta name="robots" content="noindex" />
  <title>Private tools · onlinelkb.in</title>
  <style>
    body { margin:0; font-family:system-ui,sans-serif; background:#0f172a; color:#e2e8f0; padding:32px 16px 64px; }
    .wrap { max-width:960px; margin:0 auto; text-align:center; }
    h1 { font-size:28px; margin:0 0 6px; }
    .sub { color:#94a3b8; margin:0 0 28px; font-size:14px; }
    .sub a { color:#38bdf8; }
    form { background:#1e293b; border-radius:12px; padding:24px; margin:0 auto 12px;
           display:grid; grid-template-columns:1.2fr .8fr; gap:16px; max-width:880px; text-align:left; }
    .fields { display:grid; gap:12px; align-content:start; }
    label { font-size:13px; color:#cbd5e1; display:grid; gap:4px; }
    input, textarea { padding:8px 10px; border-radius:8px; border:1px solid #475569;
                      background:#0f172a; color:#e2e8f0; font:inherit; font-size:14px; width:100%; box-sizing:border-box; }
    textarea { min-height:120px; resize:vertical; }
    button { padding:10px 14px; border-radius:8px; border:0; background:#38bdf8; color:#0f172a;
             font-weight:600; cursor:pointer; }
    .preview-wrap { display:grid; gap:8px; align-content:start; }
    .preview-box { border:1px dashed #475569; border-radius:8px; min-height:120px; display:grid; place-items:center; overflow:hidden; }
    .preview-box img { max-width:100%; max-height:240px; display:block; }
    .preview-hint { color:#64748b; font-size:12px; margin:0; }
    #status { font-size:14px; min-height:1.2em; margin:0 0 24px; color:#94a3b8; }
    .entry-card { background:#1e293b; border-radius:12px; padding:18px; margin:0 auto 14px;
                  display:grid; grid-template-columns:1.2fr .8fr; gap:16px; max-width:880px; text-align:left; list-style:none; }
    .entry-card.no-image { grid-template-columns:1fr; }
    .entry-note-col { min-width:0; }
    .entry-head { display:flex; justify-content:space-between; align-items:center; gap:8px; font-size:14px; color:#cbd5e1; margin-bottom:8px; }
    .entry-del { background:none; border:0; color:#f87171; font-size:13px; cursor:pointer; padding:2px 4px; }
    .entry-note { white-space:pre-wrap; margin:0; font-size:15px; line-height:1.5; overflow-wrap:break-word; }
    .entry-note.muted { color:#64748b; font-size:13px; }
    .entry-preview { display:grid; align-items:start; }
    .entry-img { max-width:100%; max-height:420px; border-radius:8px; justify-self:end; }
    .empty { color:#64748b; font-size:14px; }
    .empty.no-image { grid-template-columns:1fr; }
    @media (max-width:720px) {
      form, .entry-card { grid-template-columns:1fr; }
      .entry-img { justify-self:start; }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <h1>Private tools</h1>
    <p class="sub">Signed in as <strong>${username}</strong> 👋 · <a href="/logout">log out</a></p>
    <form id="entry-form">
      <div class="fields">
        <label>Date
          <input id="entry_date" name="entry_date" type="date" required />
        </label>
        <label>Note
          <textarea id="note" name="note" maxlength="5000" placeholder="Write something…"></textarea>
        </label>
        <label>Image (optional, max 15MB)
          <input id="image" name="image" type="file" accept="image/*" />
        </label>
        <button type="submit">Save entry</button>
      </div>
      <div class="preview-wrap">
        <div class="preview-box" id="preview-wrap" hidden>
          <img id="preview-img" alt="preview of selected image" />
        </div>
        <p class="preview-hint" id="preview-hint">Preview of the selected image appears here.</p>
      </div>
    </form>
    <p id="status" aria-live="polite"></p>
    <ul id="entries" style="padding:0;margin:0"></ul>
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
      $("entry_date").value = today;

      var fileEl = $("image"), pv = $("preview-img"), pvWrap = $("preview-wrap");
      var pvUrl = null;
      fileEl.addEventListener("change", function () {
        var f = fileEl.files && fileEl.files[0];
        if (pvUrl) { URL.revokeObjectURL(pvUrl); pvUrl = null; }
        if (f) { pvUrl = URL.createObjectURL(f); pv.src = pvUrl; pvWrap.hidden = false; }
        else { pv.removeAttribute("src"); pvWrap.hidden = true; }
      });

      $("entry-form").addEventListener("submit", function (e) {
        e.preventDefault();
        var status = $("status");
        status.textContent = "Saving…";
        var fd = new FormData();
        fd.append("entry_date", $("entry_date").value);
        fd.append("note", $("note").value);
        if (fileEl.files && fileEl.files[0]) fd.append("image", fileEl.files[0]);
        fetch("/api/entries", { method: "POST", body: fd })
          .then(function (res) { return res.json().then(function (d) { return { s: res.status, d: d }; }); })
          .then(function (r) {
            if (r.s !== 200 || !r.d.ok) throw new Error(r.d.error || "Save failed");
            status.textContent = "Saved ✓";
            $("note").value = ""; fileEl.value = "";
            if (pvUrl) { URL.revokeObjectURL(pvUrl); pvUrl = null; }
            pvWrap.hidden = true;
            return loadEntries();
          })
          .catch(function (err) { status.textContent = err.message || "Save failed"; });
      });

      function cardHtml(e) {
        var hasImg = !!e.image_key;
        return '<li class="entry-card' + (hasImg ? "" : " no-image") + '">' +
          '<div class="entry-note-col">' +
            '<div class="entry-head"><span>📅 ' + esc(e.entry_date) + "</span>" +
              '<button type="button" class="entry-del" data-del="' + esc(e.id) + '">delete</button></div>' +
            (e.note ? '<p class="entry-note">' + esc(e.note).replace(/\\n/g, "<br>") + "</p>"
                    : '<p class="entry-note muted">(no note)</p>') +
          "</div>" +
          (hasImg ? '<div class="entry-preview"><img loading="lazy" src="/img/' +
                    encodeURIComponent(e.image_key) + '" alt="entry image" class="entry-img"></div>' : "") +
          "</li>";
      }

      function loadEntries() {
        return fetch("/api/entries")
          .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error()); })
          .then(function (data) {
            var items = (data && data.entries) || [];
            $("entries").innerHTML = items.length
              ? items.map(cardHtml).join("")
              : '<li class="entry-card empty">No entries yet — use the form above.</li>';
          })
          .catch(function () {
            $("entries").innerHTML = '<li class="entry-card empty">Could not load entries.</li>';
          });
      }

      $("entries").addEventListener("click", function (e) {
        var btn = e.target.closest("[data-del]");
        if (!btn) return;
        if (!confirm("Delete this entry?")) return;
        fetch("/api/entries/" + btn.getAttribute("data-del"), { method: "DELETE" })
          .then(function (res) { return res.ok ? loadEntries() : null; });
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
      return request.method === "POST"
        ? handleLogin(request, env)
        : loginPage(searchParams.get("error") === "1");
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
      if (request.method === "GET") return handleEntryList(env);
      if (request.method === "DELETE") return handleEntryDelete(request, env);
      return json({ ok: false, error: "Method not allowed" }, 405);
    }

    if (pathname.startsWith("/img/")) {
      const session = await readSession(request, env);
      if (!session) return Response.redirect(`${origin}/login`, 302);
      return serveImage(request, env);
    }

    // Catch-all: not normally reachable via zone routes; staging uses env.ASSETS,
    // the live deployment passes through to the origin (GitHub Pages).
    return env.ASSETS ? env.ASSETS.fetch(request) : fetch(request);
  },
};
