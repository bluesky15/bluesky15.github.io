CREATE TABLE IF NOT EXISTS users (
  username TEXT PRIMARY KEY,
  salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_date TEXT NOT NULL,
  note TEXT DEFAULT '',
  -- legacy single-image column; mirrors the first key in images
  image_key TEXT,
  -- JSON array of KV keys, in display order (see worker/migrations)
  images TEXT NOT NULL DEFAULT '[]',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_entries_date ON entries (entry_date DESC, id DESC);

-- per-IP brute-force guard for /login: LOCK_MAX bad logins inside
-- ATTEMPT_WINDOW_MS closes the page for LOCK_MS (worker constants)
CREATE TABLE IF NOT EXISTS login_failures (
  ip TEXT PRIMARY KEY,
  fails INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0
);
