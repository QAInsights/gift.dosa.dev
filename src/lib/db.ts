export interface DbStatement {
  bind(...values: unknown[]): DbStatement;
  first<T>(column?: string): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
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
