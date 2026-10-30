import {
  AuthError,
  generateCode,
  normalizeCode,
  normalizeEmail,
  normalizeName,
  randomToken,
  secretsEqual,
  sha256Hex,
} from "./auth";
import {
  burnOtp,
  bumpOtpAttempts,
  countRecentOtps,
  createUser,
  deleteSessionByTokenHash,
  findLiveOtp,
  findSessionUser,
  findUserByEmail,
  insertOtp,
  insertSession,
  type Db,
  type UserRow,
} from "./db";

export const CODE_TTL_MS = 10 * 60 * 1000;
export const RESEND_WAIT_MS = 60 * 1000;
export const MAX_CODES_PER_HOUR = 5;
export const MAX_CODE_ATTEMPTS = 5;
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export async function requestCode(db: Db, rawEmail: unknown, now = Date.now()): Promise<{ code: string; email: string }> {
  const email = normalizeEmail(rawEmail);
  const recent = await countRecentOtps(db, email, now - 60 * 60 * 1000);
  if (recent >= MAX_CODES_PER_HOUR) {
    throw new AuthError(429, "Too many codes requested. Try again in an hour.");
  }
  const live = await findLiveOtp(db, email, now);
  if (live && now - live.created_at < RESEND_WAIT_MS) {
    throw new AuthError(429, "A code is already on its way. Wait a minute, then try again.");
  }
  const code = generateCode();
  const salt = randomToken(16);
  await insertOtp(db, {
    id: crypto.randomUUID(),
    email,
    code_hash: await sha256Hex(salt + code),
    salt,
    expires_at: now + CODE_TTL_MS,
    created_at: now,
  });
  return { code, email };
}

export async function verifyCode(
  db: Db,
  rawEmail: unknown,
  rawCode: unknown,
  rawName: unknown,
  now = Date.now(),
): Promise<{ user: UserRow; newUser: boolean; token: string }> {
  const email = normalizeEmail(rawEmail);
  const code = normalizeCode(rawCode);
  const name = normalizeName(rawName);
  const live = await findLiveOtp(db, email, now);
  if (!live) throw new AuthError(401, "That code is expired or unknown. Request a fresh one.");
  if (live.attempts >= MAX_CODE_ATTEMPTS) {
    await burnOtp(db, live.id, now);
    throw new AuthError(429, "Too many wrong guesses. Request a fresh code.");
  }
  const ok = await secretsEqual(await sha256Hex(live.salt + code), live.code_hash);
  if (!ok) {
    await bumpOtpAttempts(db, live.id, live.attempts + 1);
    throw new AuthError(401, "That code does not match. Check and try again.");
  }
  await burnOtp(db, live.id, now);
  let user = await findUserByEmail(db, email);
  let newUser = false;
  if (!user) {
    user = { id: crypto.randomUUID(), email, name, created_at: now, updated_at: now };
    await createUser(db, user);
    newUser = true;
  }
  const token = randomToken();
  await insertSession(db, {
    id: crypto.randomUUID(),
    token_hash: await sha256Hex(token),
    user_id: user.id,
    expires_at: now + SESSION_TTL_MS,
    created_at: now,
  });
  return { user, newUser, token };
}

export async function sessionUser(db: Db, token: string | null, now = Date.now()): Promise<UserRow | null> {
  if (!token) return null;
  return findSessionUser(db, await sha256Hex(token), now);
}

export async function signOut(db: Db, token: string | null): Promise<void> {
  if (!token) return;
  await deleteSessionByTokenHash(db, await sha256Hex(token));
}
