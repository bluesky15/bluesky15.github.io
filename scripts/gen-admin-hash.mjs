#!/usr/bin/env node
/**
 * Prints (to stdout) SQL that upserts a hashed user row into the D1 `users` table.
 *
 * Usage: node scripts/gen-admin-hash.mjs <username> <password> > seed.sql
 *
 * The password never leaves this process un-hashed: only a salted PBKDF2-SHA-256
 * derived key (100k iterations, 32 bytes via WebCrypto) is embedded in the SQL.
 * NEVER commit the generated SQL — it contains the password hash.
 * Apply with: npx wrangler d1 execute lkb-auth --remote --file seed.sql -y
 */
const [username, password] = process.argv.slice(2);

if (!username || !password) {
  console.error("usage: node scripts/gen-admin-hash.mjs <username> <password> > seed.sql");
  process.exit(1);
}
if (!/^[A-Za-z0-9._-]{1,32}$/.test(username)) {
  console.error("invalid username (allowed: A-Za-z0-9._-, max 32 chars)");
  process.exit(1);
}

const salt = crypto.getRandomValues(new Uint8Array(16));
const key = await crypto.subtle.importKey(
  "raw",
  new TextEncoder().encode(password),
  "PBKDF2",
  false,
  ["deriveBits"],
);
const bits = await crypto.subtle.deriveBits(
  { name: "PBKDF2", hash: "SHA-256", salt, iterations: 100_000 },
  key,
  256,
);
const hex = (buf) => [...buf].map((b) => b.toString(16).padStart(2, "0")).join("");

console.log(`INSERT INTO users (username, salt, password_hash) VALUES
  ('${username}', '${hex(salt)}', '${hex(new Uint8Array(bits))}')
  ON CONFLICT(username) DO UPDATE SET salt = excluded.salt, password_hash = excluded.password_hash;`);
