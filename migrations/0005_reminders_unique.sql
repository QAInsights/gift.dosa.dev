DELETE FROM reminders WHERE rowid NOT IN (SELECT MIN(rowid) FROM reminders GROUP BY user_id, card_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_reminders_user_card ON reminders (user_id, card_id);
