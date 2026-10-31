ALTER TABLE drawers ADD COLUMN login_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE drawers ADD COLUMN locked_until INTEGER NOT NULL DEFAULT 0;
ALTER TABLE drawers DROP COLUMN position;
DROP INDEX IF EXISTS idx_drawers_user_name;
CREATE UNIQUE INDEX IF NOT EXISTS idx_drawers_user_name ON drawers (user_id, name COLLATE NOCASE);
