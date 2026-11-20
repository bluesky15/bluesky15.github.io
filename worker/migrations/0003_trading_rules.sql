-- Daily trading rules board (editor on the left, large reading pane on the right)
CREATE TABLE IF NOT EXISTS trading_rules (
  user_id TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  rev INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
