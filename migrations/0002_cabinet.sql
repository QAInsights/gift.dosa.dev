-- Run once per database, in numeric order with the other files here.
-- Baseline: auth tables from the initial scaffold. Already applied to local + remote.
ALTER TABLE sessions ADD COLUMN unlocked TEXT NOT NULL DEFAULT '[]';

CREATE TABLE IF NOT EXISTS drawers (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  lock_hash TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_drawers_user_name ON drawers (user_id, name);
CREATE INDEX IF NOT EXISTS idx_drawers_user ON drawers (user_id);

CREATE TABLE IF NOT EXISTS cards (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  drawer_id TEXT REFERENCES drawers (id) ON DELETE SET NULL,
  retailer TEXT NOT NULL,
  nickname TEXT,
  last4 TEXT,
  balance_cents INTEGER NOT NULL DEFAULT 0 CHECK (balance_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'USD',
  expiry TEXT,
  occasion TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  notes TEXT,
  receipt_url TEXT,
  is_memory INTEGER NOT NULL DEFAULT 0 CHECK (is_memory IN (0, 1)),
  vault_number TEXT,
  vault_pin TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cards_user ON cards (user_id);
CREATE INDEX IF NOT EXISTS idx_cards_drawer ON cards (drawer_id);

CREATE TABLE IF NOT EXISTS reminders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  card_id TEXT NOT NULL REFERENCES cards (id) ON DELETE CASCADE,
  days_before INTEGER NOT NULL,
  channel TEXT NOT NULL DEFAULT 'whatsapp',
  last_sent_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reminders_user ON reminders (user_id);
CREATE INDEX IF NOT EXISTS idx_reminders_card ON reminders (card_id);

CREATE TABLE IF NOT EXISTS prefs (
  user_id TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  region TEXT,
  currency TEXT,
  date_format TEXT,
  updated_at INTEGER NOT NULL
);
