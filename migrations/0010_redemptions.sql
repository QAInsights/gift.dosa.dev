CREATE TABLE IF NOT EXISTS redemptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  card_id TEXT NOT NULL REFERENCES cards (id) ON DELETE CASCADE,
  before_cents INTEGER NOT NULL CHECK (before_cents >= 0),
  after_cents INTEGER NOT NULL CHECK (after_cents >= 0),
  kind TEXT NOT NULL DEFAULT 'manual' CHECK (kind IN ('manual', 'edit')),
  undone_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_redemptions_card ON redemptions (card_id, created_at);
