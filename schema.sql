CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS otp_codes (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  used_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_otp_email ON otp_codes (email);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  unlocked TEXT NOT NULL DEFAULT '[]',
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);

CREATE TABLE IF NOT EXISTS drawers (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  emoji TEXT,
  lock_hash TEXT,
  login_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_drawers_user_name ON drawers (user_id, name COLLATE NOCASE);
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
  sample INTEGER NOT NULL DEFAULT 0 CHECK (sample IN (0, 1)),
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
CREATE UNIQUE INDEX IF NOT EXISTS idx_reminders_user_card ON reminders (user_id, card_id);

CREATE TABLE IF NOT EXISTS prefs (
  user_id TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  region TEXT,
  currency TEXT,
  date_format TEXT,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS todos (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_todos_user ON todos (user_id);
