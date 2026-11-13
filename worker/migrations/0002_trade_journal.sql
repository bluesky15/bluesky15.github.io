-- 100-day trading journal state per user
CREATE TABLE IF NOT EXISTS trade_journal (
  user_id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
