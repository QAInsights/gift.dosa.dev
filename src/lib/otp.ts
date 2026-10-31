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
  burnOtpIfLive,
  bumpOtpAttempts,
  countRecentOtps,
  createUser,
  deleteSessionByTokenHash,
  findLiveOtp,
  findLiveOtps,
  findSessionContext,
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

export async function requestCode(
  db: Db,
  rawEmail: unknown,
  now = Date.now(),
): Promise<{ code: string; email: string; id: string }> {
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
  const id = crypto.randomUUID();
  await insertOtp(db, {
    id,
    email,
    code_hash: await sha256Hex(salt + code),
    salt,
    expires_at: now + CODE_TTL_MS,
    created_at: now,
  });
  return { code, email, id };
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
  const { results: codes } = await findLiveOtps(db, email, now);
  if (codes.length === 0) throw new AuthError(401, "That code is expired or unknown. Request a fresh one.");
  const usable = codes.filter((c) => c.attempts < MAX_CODE_ATTEMPTS);
  if (usable.length === 0) {
    for (const spent of codes) await burnOtp(db, spent.id, now);
    throw new AuthError(429, "Too many wrong guesses. Request a fresh code.");
  }
  for (const candidate of usable) {
    if (await secretsEqual(await sha256Hex(candidate.salt + code), candidate.code_hash)) {
      const burned = await burnOtpIfLive(db, candidate.id, now);
      if (!burned) throw new AuthError(401, "That code was already used. Request a fresh one.");
      return finishVerify(db, email, name, now);
    }
  }
  await bumpOtpAttempts(db, usable[0].id, usable[0].attempts + 1);
  throw new AuthError(401, "That code does not match. Check and try again.");
}

async function finishVerify(
  db: Db,
  email: string,
  name: string | null,
  now: number,
): Promise<{ user: UserRow; newUser: boolean; token: string }> {
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

export async function sessionContext(
  db: Db,
  token: string | null,
  now = Date.now(),
): Promise<{ user: UserRow; unlocked: string[]; tokenHash: string } | null> {
  if (!token) return null;
  const tokenHash = await sha256Hex(token);
  const row = await findSessionContext(db, tokenHash, now);
  if (!row) return null;
  let unlocked: string[] = [];
  try {
    const parsed: unknown = JSON.parse(row.unlocked);
    if (Array.isArray(parsed)) unlocked = parsed.filter((id): id is string => typeof id === "string");
  } catch {
    unlocked = [];
  }
  const { id, email, name, created_at, updated_at } = row;
  return { user: { id, email, name, created_at, updated_at }, unlocked, tokenHash };
}
