export interface DbStatement {
  bind(...values: unknown[]): DbStatement;
  first<T>(column?: string): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta?: { changes?: number } }>;
}

export interface Db {
  prepare(query: string): DbStatement;
}

export interface UserRow {
  id: string;
  email: string;
  name: string | null;
  created_at: number;
  updated_at: number;
}

export interface OtpRow {
  id: string;
  email: string;
  code_hash: string;
  salt: string;
  expires_at: number;
  attempts: number;
  used_at: number | null;
  created_at: number;
}

export interface SessionRow {
  id: string;
  token_hash: string;
  user_id: string;
  expires_at: number;
  created_at: number;
}

const USER_COLUMNS = "id, email, name, created_at, updated_at";

export function findUserByEmail(db: Db, email: string): Promise<UserRow | null> {
  return db
    .prepare(`SELECT ${USER_COLUMNS} FROM users WHERE email = ?`)
    .bind(email)
    .first<UserRow>();
}

export function createUser(db: Db, user: UserRow): Promise<unknown> {
  return db
    .prepare("INSERT INTO users (id, email, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
    .bind(user.id, user.email, user.name, user.created_at, user.updated_at)
    .run();
}

export async function countRecentOtps(db: Db, email: string, since: number): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM otp_codes WHERE email = ? AND created_at > ?")
    .bind(email, since)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export function findLiveOtp(db: Db, email: string, now: number): Promise<OtpRow | null> {
  return db
    .prepare(
      "SELECT id, email, code_hash, salt, expires_at, attempts, used_at, created_at FROM otp_codes WHERE email = ? AND used_at IS NULL AND expires_at > ? ORDER BY created_at DESC LIMIT 1",
    )
    .bind(email, now)
    .first<OtpRow>();
}

export function insertOtp(
  db: Db,
  row: { id: string; email: string; code_hash: string; salt: string; expires_at: number; created_at: number },
): Promise<unknown> {
  return db
    .prepare(
      "INSERT INTO otp_codes (id, email, code_hash, salt, expires_at, attempts, used_at, created_at) VALUES (?, ?, ?, ?, ?, 0, NULL, ?)",
    )
    .bind(row.id, row.email, row.code_hash, row.salt, row.expires_at, row.created_at)
    .run();
}

export function bumpOtpAttempts(db: Db, id: string, attempts: number): Promise<unknown> {
  return db.prepare("UPDATE otp_codes SET attempts = ? WHERE id = ?").bind(attempts, id).run();
}

export function burnOtp(db: Db, id: string, now: number): Promise<unknown> {
  return db.prepare("UPDATE otp_codes SET used_at = ? WHERE id = ?").bind(now, id).run();
}

export async function burnOtpIfLive(db: Db, id: string, now: number): Promise<boolean> {
  const result = await db
    .prepare("UPDATE otp_codes SET used_at = ? WHERE id = ? AND used_at IS NULL")
    .bind(now, id)
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

export function deleteOtp(db: Db, id: string): Promise<unknown> {
  return db.prepare("DELETE FROM otp_codes WHERE id = ?").bind(id).run();
}

export function findLiveOtps(db: Db, email: string, now: number): Promise<{ results: OtpRow[] }> {
  return db
    .prepare(
      "SELECT id, email, code_hash, salt, expires_at, attempts, used_at, created_at FROM otp_codes WHERE email = ? AND used_at IS NULL AND expires_at > ? ORDER BY created_at DESC",
    )
    .bind(email, now)
    .all<OtpRow>();
}

export function insertSession(db: Db, row: SessionRow): Promise<unknown> {
  return db
    .prepare("INSERT INTO sessions (id, token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(row.id, row.token_hash, row.user_id, row.expires_at, row.created_at)
    .run();
}

export function findSessionUser(db: Db, tokenHash: string, now: number): Promise<UserRow | null> {
  return db
    .prepare(
      `SELECT u.id, u.email, u.name, u.created_at, u.updated_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?`,
    )
    .bind(tokenHash, now)
    .first<UserRow>();
}

export function deleteSessionByTokenHash(db: Db, tokenHash: string): Promise<unknown> {
  return db.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(tokenHash).run();
}

export interface DrawerRow {
  id: string;
  user_id: string;
  name: string;
  emoji: string | null;
  lock_hash: string | null;
  login_attempts: number;
  locked_until: number;
  created_at: number;
  updated_at: number;
}

export interface CardRow {
  id: string;
  user_id: string;
  drawer_id: string | null;
  retailer: string;
  nickname: string | null;
  last4: string | null;
  balance_cents: number;
  currency: string;
  expiry: string | null;
  occasion: string | null;
  tags: string;
  notes: string | null;
  receipt_url: string | null;
  is_memory: number;
  sample: number;
  vault_number: string | null;
  vault_pin: string | null;
  created_at: number;
  updated_at: number;
}

export interface SessionContextRow extends UserRow {
  unlocked: string;
}

const DRAWER_COLUMNS = "id, user_id, name, emoji, lock_hash, login_attempts, locked_until, created_at, updated_at";
const CARD_COLUMNS =
  "id, user_id, drawer_id, retailer, nickname, last4, balance_cents, currency, expiry, occasion, tags, notes, receipt_url, is_memory, sample, vault_number, vault_pin, created_at, updated_at";

export function listDrawers(db: Db, userId: string): Promise<{ results: DrawerRow[] }> {
  return db
    .prepare(`SELECT ${DRAWER_COLUMNS} FROM drawers WHERE user_id = ? ORDER BY name ASC`)
    .bind(userId)
    .all<DrawerRow>();
}

export function findDrawer(db: Db, id: string, userId: string): Promise<DrawerRow | null> {
  return db
    .prepare(`SELECT ${DRAWER_COLUMNS} FROM drawers WHERE id = ? AND user_id = ?`)
    .bind(id, userId)
    .first<DrawerRow>();
}

export function findDrawerByName(db: Db, userId: string, name: string): Promise<DrawerRow | null> {
  return db
    .prepare(`SELECT ${DRAWER_COLUMNS} FROM drawers WHERE user_id = ? AND name = ? COLLATE NOCASE`)
    .bind(userId, name)
    .first<DrawerRow>();
}

export function insertDrawer(db: Db, row: DrawerRow): Promise<unknown> {
  return db
    .prepare(
      "INSERT INTO drawers (id, user_id, name, emoji, lock_hash, login_attempts, locked_until, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(row.id, row.user_id, row.name, row.emoji, row.lock_hash, row.login_attempts, row.locked_until, row.created_at, row.updated_at)
    .run();
}

export function updateDrawerEmojiRow(db: Db, id: string, userId: string, emoji: string, now: number): Promise<unknown> {
  return db.prepare("UPDATE drawers SET emoji = ?, updated_at = ? WHERE id = ? AND user_id = ?").bind(emoji, now, id, userId).run();
}

export interface TodoRow {
  id: string;
  user_id: string;
  text: string;
  done: number;
  created_at: number;
  updated_at: number;
}

export function listTodos(db: Db, userId: string): Promise<{ results: TodoRow[] }> {
  return db
    .prepare("SELECT id, user_id, text, done, created_at, updated_at FROM todos WHERE user_id = ? ORDER BY done ASC, created_at DESC")
    .bind(userId)
    .all<TodoRow>();
}

export function insertTodo(db: Db, row: TodoRow): Promise<unknown> {
  return db
    .prepare("INSERT INTO todos (id, user_id, text, done, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(row.id, row.user_id, row.text, row.done, row.created_at, row.updated_at)
    .run();
}

export function findTodo(db: Db, id: string, userId: string): Promise<TodoRow | null> {
  return db
    .prepare("SELECT id, user_id, text, done, created_at, updated_at FROM todos WHERE id = ? AND user_id = ?")
    .bind(id, userId)
    .first<TodoRow>();
}

export function updateTodo(db: Db, row: TodoRow): Promise<unknown> {
  return db
    .prepare("UPDATE todos SET text = ?, done = ?, updated_at = ? WHERE id = ? AND user_id = ?")
    .bind(row.text, row.done, row.updated_at, row.id, row.user_id)
    .run();
}

export function deleteTodo(db: Db, id: string, userId: string): Promise<unknown> {
  return db.prepare("DELETE FROM todos WHERE id = ? AND user_id = ?").bind(id, userId).run();
}

export interface RedemptionRow {
  id: string;
  user_id: string;
  card_id: string;
  before_cents: number;
  after_cents: number;
  kind: "manual" | "edit";
  undone_at: number | null;
  created_at: number;
}

const REDEMPTION_COLUMNS = "id, user_id, card_id, before_cents, after_cents, kind, undone_at, created_at";

export function insertRedemption(db: Db, row: RedemptionRow): Promise<unknown> {
  return db
    .prepare(
      `INSERT INTO redemptions (${REDEMPTION_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(row.id, row.user_id, row.card_id, row.before_cents, row.after_cents, row.kind, row.undone_at, row.created_at)
    .run();
}

export function findLatestRedemption(db: Db, cardId: string, userId: string): Promise<RedemptionRow | null> {
  return db
    .prepare(
      `SELECT ${REDEMPTION_COLUMNS} FROM redemptions WHERE card_id = ? AND user_id = ? AND undone_at IS NULL ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(cardId, userId)
    .first<RedemptionRow>();
}

export function findRedemption(db: Db, id: string, cardId: string, userId: string): Promise<RedemptionRow | null> {
  return db
    .prepare(`SELECT ${REDEMPTION_COLUMNS} FROM redemptions WHERE id = ? AND card_id = ? AND user_id = ?`)
    .bind(id, cardId, userId)
    .first<RedemptionRow>();
}

export function markRedemptionUndone(
  db: Db,
  id: string,
  userId: string,
  now: number,
): Promise<{ meta?: { changes?: number } }> {
  return db
    .prepare("UPDATE redemptions SET undone_at = ? WHERE id = ? AND user_id = ? AND undone_at IS NULL")
    .bind(now, id, userId)
    .run();
}

export function renameDrawer(db: Db, id: string, userId: string, name: string, now: number): Promise<unknown> {
  return db
    .prepare("UPDATE drawers SET name = ?, updated_at = ? WHERE id = ? AND user_id = ?")
    .bind(name, now, id, userId)
    .run();
}

export function setDrawerLock(db: Db, id: string, userId: string, lockHash: string | null, now: number): Promise<unknown> {
  return db
    .prepare("UPDATE drawers SET lock_hash = ?, updated_at = ? WHERE id = ? AND user_id = ?")
    .bind(lockHash, now, id, userId)
    .run();
}

export function updateDrawerAttempts(
  db: Db,
  id: string,
  userId: string,
  attempts: number,
  lockedUntil: number,
  now: number,
): Promise<unknown> {
  return db
    .prepare("UPDATE drawers SET login_attempts = ?, locked_until = ?, updated_at = ? WHERE id = ? AND user_id = ?")
    .bind(attempts, lockedUntil, now, id, userId)
    .run();
}

export function clearDrawerVaults(db: Db, drawerId: string, userId: string): Promise<unknown> {
  return db
    .prepare("UPDATE cards SET vault_number = NULL, vault_pin = NULL WHERE drawer_id = ? AND user_id = ?")
    .bind(drawerId, userId)
    .run();
}

export function sumBalanceByDrawer(
  db: Db,
  userId: string,
): Promise<{ results: { drawer_id: string; currency: string; cents: number }[] }> {
  return db
    .prepare(
      "SELECT drawer_id, currency, SUM(balance_cents) AS cents FROM cards WHERE user_id = ? AND drawer_id IS NOT NULL GROUP BY drawer_id, currency",
    )
    .bind(userId)
    .all<{ drawer_id: string; currency: string; cents: number }>();
}

export function deleteDrawer(db: Db, id: string, userId: string): Promise<unknown> {
  return db.prepare("DELETE FROM drawers WHERE id = ? AND user_id = ?").bind(id, userId).run();
}

export function unfileDrawerCards(db: Db, drawerId: string, userId: string): Promise<unknown> {
  return db
    .prepare("UPDATE cards SET drawer_id = NULL WHERE drawer_id = ? AND user_id = ?")
    .bind(drawerId, userId)
    .run();
}

export async function countDrawerCards(db: Db, drawerId: string, userId: string): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM cards WHERE drawer_id = ? AND user_id = ?")
    .bind(drawerId, userId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export function countCardsByDrawer(db: Db, userId: string): Promise<{ results: { drawer_id: string; n: number }[] }> {
  return db
    .prepare("SELECT drawer_id, COUNT(*) AS n FROM cards WHERE user_id = ? AND drawer_id IS NOT NULL GROUP BY drawer_id")
    .bind(userId)
    .all<{ drawer_id: string; n: number }>();
}

export function findSessionContext(db: Db, tokenHash: string, now: number): Promise<SessionContextRow | null> {
  return db
    .prepare(
      `SELECT u.id, u.email, u.name, u.created_at, u.updated_at, s.unlocked FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?`,
    )
    .bind(tokenHash, now)
    .first<SessionContextRow>();
}

export function updateSessionUnlocked(db: Db, tokenHash: string, unlocked: string): Promise<unknown> {
  return db.prepare("UPDATE sessions SET unlocked = ? WHERE token_hash = ?").bind(unlocked, tokenHash).run();
}

export function listUserCards(db: Db, userId: string): Promise<{ results: CardRow[] }> {
  return db.prepare(`SELECT ${CARD_COLUMNS} FROM cards WHERE user_id = ?`).bind(userId).all<CardRow>();
}

export function findCard(db: Db, id: string, userId: string): Promise<CardRow | null> {
  return db
    .prepare(`SELECT ${CARD_COLUMNS} FROM cards WHERE id = ? AND user_id = ?`)
    .bind(id, userId)
    .first<CardRow>();
}

export function insertCard(db: Db, row: CardRow): Promise<unknown> {
  return db
    .prepare(
      "INSERT INTO cards (id, user_id, drawer_id, retailer, nickname, last4, balance_cents, currency, expiry, occasion, tags, notes, receipt_url, is_memory, sample, vault_number, vault_pin, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(
      row.id, row.user_id, row.drawer_id, row.retailer, row.nickname, row.last4, row.balance_cents,
      row.currency, row.expiry, row.occasion, row.tags, row.notes, row.receipt_url, row.is_memory,
      row.sample, row.vault_number, row.vault_pin, row.created_at, row.updated_at,
    )
    .run();
}

export function updateCard(
  db: Db,
  row: {
    id: string; user_id: string; drawer_id: string | null; retailer: string; nickname: string | null;
    last4: string | null; balance_cents: number; currency: string; expiry: string | null;
    occasion: string | null; tags: string; notes: string | null; is_memory: number; updated_at: number;
  },
): Promise<unknown> {
  return db
    .prepare(
      "UPDATE cards SET drawer_id = ?, retailer = ?, nickname = ?, last4 = ?, balance_cents = ?, currency = ?, expiry = ?, occasion = ?, tags = ?, notes = ?, is_memory = ?, updated_at = ? WHERE id = ? AND user_id = ?",
    )
    .bind(
      row.drawer_id, row.retailer, row.nickname, row.last4, row.balance_cents, row.currency,
      row.expiry, row.occasion, row.tags, row.notes, row.is_memory, row.updated_at, row.id, row.user_id,
    )
    .run();
}

export function updateCardVault(
  db: Db, id: string, userId: string, number: string | null, pin: string | null, now: number,
): Promise<unknown> {
  return db
    .prepare("UPDATE cards SET vault_number = ?, vault_pin = ?, updated_at = ? WHERE id = ? AND user_id = ?")
    .bind(number, pin, now, id, userId)
    .run();
}

export function deleteCard(db: Db, id: string, userId: string): Promise<unknown> {
  return db.prepare("DELETE FROM cards WHERE id = ? AND user_id = ?").bind(id, userId).run();
}

export function deleteSampleCards(db: Db, userId: string): Promise<unknown> {
  return db.prepare("DELETE FROM cards WHERE user_id = ? AND sample = 1").bind(userId).run();
}

export interface ReminderRow {
  id: string;
  user_id: string;
  card_id: string;
  days_before: number;
  channel: string;
  last_sent_at: number | null;
  created_at: number;
}

export function findCardReminder(db: Db, cardId: string, userId: string): Promise<ReminderRow | null> {
  return db
    .prepare(
      "SELECT id, user_id, card_id, days_before, channel, last_sent_at, created_at FROM reminders WHERE card_id = ? AND user_id = ?",
    )
    .bind(cardId, userId)
    .first<ReminderRow>();
}

export function insertReminder(db: Db, row: ReminderRow): Promise<unknown> {
  return db
    .prepare(
      "INSERT INTO reminders (id, user_id, card_id, days_before, channel, last_sent_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(row.id, row.user_id, row.card_id, row.days_before, row.channel, row.last_sent_at, row.created_at)
    .run();
}

export function deleteCardReminders(db: Db, cardId: string, userId: string): Promise<unknown> {
  return db.prepare("DELETE FROM reminders WHERE card_id = ? AND user_id = ?").bind(cardId, userId).run();
}

export interface PrefsRow {
  user_id: string;
  region: string | null;
  currency: string | null;
  date_format: string | null;
  updated_at: number;
}

export function findUserById(db: Db, id: string): Promise<UserRow | null> {
  return db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`).bind(id).first<UserRow>();
}

export function updateUserName(db: Db, id: string, name: string | null, now: number): Promise<unknown> {
  return db.prepare("UPDATE users SET name = ?, updated_at = ? WHERE id = ?").bind(name, now, id).run();
}

export function findPrefs(db: Db, userId: string): Promise<PrefsRow | null> {
  return db
    .prepare("SELECT user_id, region, currency, date_format, updated_at FROM prefs WHERE user_id = ?")
    .bind(userId)
    .first<PrefsRow>();
}

export interface EmailReminderRow {
  reminder_id: string;
  email: string;
  retailer: string;
  balance_cents: number;
  currency: string;
  expiry: string | null;
  days_before: number;
  last_sent_at: number | null;
}

export function listEmailReminders(db: Db): Promise<{ results: EmailReminderRow[] }> {
  return db
    .prepare(
      "SELECT r.id AS reminder_id, u.email AS email, c.retailer AS retailer, c.balance_cents AS balance_cents, " +
        "c.currency AS currency, c.expiry AS expiry, r.days_before AS days_before, r.last_sent_at AS last_sent_at " +
        "FROM reminders r JOIN cards c ON c.id = r.card_id AND c.user_id = r.user_id " +
        "JOIN users u ON u.id = r.user_id LEFT JOIN drawers d ON d.id = c.drawer_id " +
        "WHERE r.channel = 'email' AND c.is_memory = 0 AND c.sample = 0 AND (c.drawer_id IS NULL OR d.lock_hash IS NULL) " +
        "ORDER BY c.expiry ASC",
    )
    .all<EmailReminderRow>();
}

export function markReminderSent(
  db: Db,
  id: string,
  now: number,
  expectedLastSent: number | null,
): Promise<{ meta?: { changes?: number } }> {
  return db
    .prepare("UPDATE reminders SET last_sent_at = ? WHERE id = ? AND last_sent_at IS ?")
    .bind(now, id, expectedLastSent)
    .run();
}

export function releaseReminderClaim(
  db: Db,
  id: string,
  claimedAt: number,
  restoreLastSent: number | null,
): Promise<unknown> {
  return db
    .prepare("UPDATE reminders SET last_sent_at = ? WHERE id = ? AND last_sent_at = ?")
    .bind(restoreLastSent, id, claimedAt)
    .run();
}

export function resetReminderSent(db: Db, cardId: string, userId: string): Promise<unknown> {
  return db.prepare("UPDATE reminders SET last_sent_at = NULL WHERE card_id = ? AND user_id = ?").bind(cardId, userId).run();
}

export function upsertPrefs(db: Db, row: PrefsRow): Promise<unknown> {
  return db
    .prepare(
      "INSERT INTO prefs (user_id, region, currency, date_format, updated_at) VALUES (?, ?, ?, ?, ?) " +
        "ON CONFLICT(user_id) DO UPDATE SET region = excluded.region, currency = excluded.currency, " +
        "date_format = excluded.date_format, updated_at = excluded.updated_at",
    )
    .bind(row.user_id, row.region, row.currency, row.date_format, row.updated_at)
    .run();
}

export interface WhatsappLinkRow {
  user_id: string;
  phone: string;
  code: string;
  verified_at: number | null;
  created_at: number;
}

export interface WhatsappPendingRow {
  id: string;
  user_id: string;
  phone: string;
  payload: string;
  created_at: number;
}

export function findWhatsappLinkByUser(db: Db, userId: string): Promise<WhatsappLinkRow | null> {
  return db
    .prepare("SELECT user_id, phone, code, verified_at, created_at FROM whatsapp_links WHERE user_id = ?")
    .bind(userId)
    .first<WhatsappLinkRow>();
}

export function findWhatsappLinkByPhone(db: Db, phone: string): Promise<WhatsappLinkRow | null> {
  return db
    .prepare("SELECT user_id, phone, code, verified_at, created_at FROM whatsapp_links WHERE phone = ?")
    .bind(phone)
    .first<WhatsappLinkRow>();
}

export function upsertWhatsappLink(db: Db, row: WhatsappLinkRow): Promise<unknown> {
  return db
    .prepare(
      "INSERT INTO whatsapp_links (user_id, phone, code, verified_at, created_at) VALUES (?, ?, ?, ?, ?) " +
        "ON CONFLICT(user_id) DO UPDATE SET phone = excluded.phone, code = excluded.code, " +
        "verified_at = excluded.verified_at, created_at = excluded.created_at",
    )
    .bind(row.user_id, row.phone, row.code, row.verified_at, row.created_at)
    .run();
}

export function verifyWhatsappLink(db: Db, userId: string, now: number): Promise<unknown> {
  return db
    .prepare("UPDATE whatsapp_links SET verified_at = ? WHERE user_id = ?")
    .bind(now, userId)
    .run();
}

export function deleteWhatsappLink(db: Db, userId: string): Promise<unknown> {
  return db.prepare("DELETE FROM whatsapp_links WHERE user_id = ?").bind(userId).run();
}

export function insertWhatsappPending(db: Db, row: WhatsappPendingRow): Promise<unknown> {
  return db
    .prepare("INSERT INTO whatsapp_pending (id, user_id, phone, payload, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(row.id, row.user_id, row.phone, row.payload, row.created_at)
    .run();
}

export function takeWhatsappPending(db: Db, id: string, userId: string): Promise<WhatsappPendingRow | null> {
  return db
    .prepare("DELETE FROM whatsapp_pending WHERE id = ? AND user_id = ? RETURNING id, user_id, phone, payload, created_at")
    .bind(id, userId)
    .first<WhatsappPendingRow>();
}
