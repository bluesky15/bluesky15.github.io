/**
 * Standalone Cloudflare Worker for onlinelkb.in.
 *
 * Attached only to these routes (see wrangler.toml):
 *   onlinelkb.in/login   -> login form + credential check
 *   onlinelkb.in/hello   -> gated page, generated live by this worker
 *   onlinelkb.in/logout  -> clears session
 *
 * Credentials live in D1 (binding DB) as salted PBKDF2-SHA-256 hashes
 * (100k iterations, 32 bytes) — see worker/schema.sql and
 * scripts/gen-admin-hash.mjs. No plaintext credentials in this repo.
 *
 * Sessions are HMAC-signed cookies: "username.expiryMs.signature",
 * signed as HMAC-SHA256(username|expiry, SESSION_SECRET). The exp check
 * is a fail-closed fallback; set SESSION_SECRET in prod (wrangler secret put).
 */

const COOKIE = "lkb_session";
const TTL_MS = 24 * 60 * 60 * 1000; // 1 day while testing
const FALLBACK_SECRET = "local-dev-secret";
const USERNAME_RE = /^[A-Za-z0-9._-]{1,32}$/;

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

// cookie value: "<username>.<expiryMs>.<hmac(username|expiryMs)>" -> username or null
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

const helloPage = (username) => page(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Hello · onlinelkb.in</title>
</head>
<body style="margin:0;font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;display:grid;place-items:center;min-height:100vh;text-align:center">
  <div>
    <h1 style="font-size:48px;margin:0 0 8px">Hello world 👋</h1>
    <p style="margin:0 0 16px">Generated live by the <code>onlinelkb-login</code> worker at<br /><code>${new Date().toISOString()}</code></p>
    <p style="margin:0 0 24px">Signed in as <strong>${username}</strong></p>
    <p style="margin:0"><a href="/logout" style="color:#38bdf8">Log out</a> · <a href="/" style="color:#38bdf8">Back to site</a></p>
  </div>
</body>
</html>`);

export default {
  async fetch(request, env) {
    const { pathname, origin, searchParams } = new URL(request.url);

    if (pathname === "/login") {
      return request.method === "POST"
        ? handleLogin(request, env)
        : loginPage(searchParams.get("error") === "1");
    }

    if (pathname === "/hello") {
      const username = await readSession(request, env);
      return username ? helloPage(username) : Response.redirect(`${origin}/login`, 302);
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

    // Catch-all: not normally reachable since routes only match /login, /hello, /logout.
    // env.ASSETS exists only in the staging deployment (worker-staging); on the live
    // zone routes we pass through to the origin (GitHub Pages).
    return env.ASSETS ? env.ASSETS.fetch(request) : fetch(request);
  },
};
