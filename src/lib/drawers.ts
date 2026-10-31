import { AuthError, base64Url, randomToken, secretsEqual } from "./auth";
import {
  clearDrawerVaults,
  countCardsByDrawer,
  countDrawerCards,
  deleteDrawer as deleteDrawerRow,
  findDrawer,
  findDrawerByName,
  insertDrawer,
  listDrawers,
  renameDrawer as renameDrawerRow,
  setDrawerLock as setDrawerLockRow,
  updateDrawerEmojiRow,
  sumBalanceByDrawer,
  unfileDrawerCards,
  updateDrawerAttempts,
  type Db,
  type DrawerRow,
} from "./db";

export function normalizeDrawerName(raw: unknown): string {
  if (typeof raw !== "string") throw new AuthError(400, "Name the drawer.");
  const name = raw.trim().replace(/\s+/g, " ");
  if (name.length === 0 || name.length > 60) {
    throw new AuthError(400, "Keep drawer names between 1 and 60 characters.");
  }
  if (name.toLowerCase() === "personal") {
    throw new AuthError(400, "Personal is reserved for your loose cards. Pick another name.");
  }
  return name;
}

export function normalizeLockPassword(raw: unknown): string {
  if (typeof raw !== "string" || raw.length < 8 || raw.length > 128) {
    throw new AuthError(400, "Use a drawer password between 8 and 128 characters.");
  }
  return raw;
}

export const MAX_DRAWER_ATTEMPTS = 5;
export const DRAWER_LOCKOUT_MS = 15 * 60 * 1000;

const PBKDF2_ITERATIONS = 100000;

async function pbkdf2(password: string, salt: string, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: new TextEncoder().encode(salt), iterations, hash: "SHA-256" },
    key,
    256,
  );
  return base64Url(new Uint8Array(bits));
}

export async function hashLockPassword(password: string): Promise<string> {
  const salt = randomToken(16);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${salt}$${await pbkdf2(password, salt, PBKDF2_ITERATIONS)}`;
}

export async function verifyLockPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations <= 0 || iterations > 1000000) return false;
  return secretsEqual(await pbkdf2(password, parts[2], iterations), parts[3]);
}

async function ownDrawer(db: Db, userId: string, drawerId: string): Promise<DrawerRow> {
  const drawer = await findDrawer(db, drawerId, userId);
  if (!drawer) throw new AuthError(404, "That drawer is not on file.");
  return drawer;
}

export const DEFAULT_DRAWER_EMOJI = "🎁";

export const DRAWER_EMOJIS = [
  "🎁", "🎂", "🎉", "💝", "🧧", "💐", "🍰", "🎄", "💍", "👶",
  "🎓", "💼", "🏠", "✈️", "🍽️", "☕", "🎮", "📚", "💄", "👗",
  "👟", "⌚", "💎", "🕯️", "🧸", "🌸", "❤️", "⭐", "🎵", "⚽",
] as const;

const DRAWER_EMOJI_SET: ReadonlySet<string> = new Set(DRAWER_EMOJIS);

export function normalizeDrawerEmoji(raw: unknown): string {
  if (typeof raw !== "string" || !DRAWER_EMOJI_SET.has(raw.trim())) {
    throw new AuthError(400, "Pick one of the drawer emojis.");
  }
  return raw.trim();
}

export async function setDrawerEmoji(
  db: Db,
  userId: string,
  drawerId: string,
  rawEmoji: unknown,
  now = Date.now(),
): Promise<string> {
  const drawer = await ownDrawer(db, userId, drawerId);
  const emoji = normalizeDrawerEmoji(rawEmoji);
  await updateDrawerEmojiRow(db, drawer.id, userId, emoji, now);
  return emoji;
}

function duplicateName(error: unknown): boolean {
  return error instanceof Error && /unique/i.test(error.message);
}

export async function createDrawer(
  db: Db,
  userId: string,
  rawName: unknown,
  rawPassword: unknown,
  now = Date.now(),
): Promise<DrawerRow> {
  const name = normalizeDrawerName(rawName);
  if (await findDrawerByName(db, userId, name)) {
    throw new AuthError(409, "You already have a drawer by that name.");
  }
  const lock_hash =
    rawPassword === undefined || rawPassword === null || rawPassword === ""
      ? null
      : await hashLockPassword(normalizeLockPassword(rawPassword));
  const row: DrawerRow = {
    id: crypto.randomUUID(),
    user_id: userId,
    name,
    emoji: DEFAULT_DRAWER_EMOJI,
    lock_hash,
    login_attempts: 0,
    locked_until: 0,
    created_at: now,
    updated_at: now,
  };
  try {
    await insertDrawer(db, row);
  } catch (error) {
    if (duplicateName(error)) throw new AuthError(409, "You already have a drawer by that name.");
    throw error;
  }
  return row;
}

export async function renameDrawer(
  db: Db,
  userId: string,
  drawerId: string,
  rawName: unknown,
  now = Date.now(),
  unlocked: string[] = [],
): Promise<DrawerRow> {
  const drawer = await ownDrawer(db, userId, drawerId);
  if (drawer.lock_hash && !unlocked.includes(drawer.id)) {
    throw new AuthError(403, "Unlock this drawer first.");
  }
  const name = normalizeDrawerName(rawName);
  const clash = await findDrawerByName(db, userId, name);
  if (clash && clash.id !== drawer.id) {
    throw new AuthError(409, "You already have a drawer by that name.");
  }
  try {
    await renameDrawerRow(db, drawer.id, userId, name, now);
  } catch (error) {
    if (duplicateName(error)) throw new AuthError(409, "You already have a drawer by that name.");
    throw error;
  }
  return { ...drawer, name, updated_at: now };
}

export async function setLock(
  db: Db,
  userId: string,
  drawerId: string,
  rawPassword: unknown,
  rawCurrent: unknown,
  now = Date.now(),
): Promise<DrawerRow> {
  const drawer = await ownDrawer(db, userId, drawerId);
  const password = normalizeLockPassword(rawPassword);
  if (drawer.lock_hash) {
    const current = typeof rawCurrent === "string" ? rawCurrent : "";
    if (!(await verifyLockPassword(current, drawer.lock_hash))) {
      throw new AuthError(401, "The current drawer password does not match.");
    }
  }
  const lock_hash = await hashLockPassword(password);
  await setDrawerLockRow(db, drawer.id, userId, lock_hash, now);
  return { ...drawer, lock_hash, updated_at: now };
}

export async function removeLock(
  db: Db,
  userId: string,
  drawerId: string,
  rawPassword: unknown,
  now = Date.now(),
): Promise<DrawerRow> {
  const drawer = await ownDrawer(db, userId, drawerId);
  if (!drawer.lock_hash) throw new AuthError(400, "This drawer has no lock.");
  if (!(await verifyLockPassword(normalizeLockPassword(rawPassword), drawer.lock_hash))) {
    throw new AuthError(401, "That drawer password does not match.");
  }
  await setDrawerLockRow(db, drawer.id, userId, null, now);
  return { ...drawer, lock_hash: null, updated_at: now };
}

export async function unlockDrawer(
  db: Db,
  userId: string,
  drawerId: string,
  rawPassword: unknown,
  unlocked: string[],
  now = Date.now(),
): Promise<string[]> {
  const drawer = await ownDrawer(db, userId, drawerId);
  if (!drawer.lock_hash) throw new AuthError(400, "This drawer has no lock.");
  if (drawer.locked_until > now) {
    throw new AuthError(429, "Too many wrong guesses. Try again in a few minutes.");
  }
  const password = typeof rawPassword === "string" ? rawPassword : "";
  if (!(await verifyLockPassword(password, drawer.lock_hash))) {
    const attempts = drawer.login_attempts + 1;
    const locked = attempts >= MAX_DRAWER_ATTEMPTS;
    await updateDrawerAttempts(db, drawer.id, userId, locked ? 0 : attempts, locked ? now + DRAWER_LOCKOUT_MS : 0, now);
    throw new AuthError(401, "That drawer password does not match.");
  }
  if (drawer.login_attempts > 0 || drawer.locked_until > 0) {
    await updateDrawerAttempts(db, drawer.id, userId, 0, 0, now);
  }
  return unlocked.includes(drawer.id) ? unlocked : [...unlocked, drawer.id];
}

export function relockDrawer(drawerId: string, unlocked: string[]): string[] {
  return unlocked.filter((id) => id !== drawerId);
}

export function isUnlocked(drawer: DrawerRow, unlocked: string[]): boolean {
  return !drawer.lock_hash || unlocked.includes(drawer.id);
}

export async function removeDrawer(db: Db, userId: string, drawerId: string, unlocked: string[]): Promise<void> {
  const drawer = await ownDrawer(db, userId, drawerId);
  if (drawer.lock_hash && !unlocked.includes(drawer.id)) {
    throw new AuthError(403, "Unlock this drawer first.");
  }
  await clearDrawerVaults(db, drawer.id, userId);
  await unfileDrawerCards(db, drawer.id, userId);
  await deleteDrawerRow(db, drawer.id, userId);
}

export interface PublicDrawer {
  id: string;
  name: string;
  emoji: string;
  locked: boolean;
  unlocked: boolean;
  cardCount: number;
  subtotals: Record<string, number>;
  updated_at: number;
}

export function toPublicDrawer(
  drawer: DrawerRow,
  unlocked: string[],
  cardCount: number,
  subtotals: Record<string, number>,
): PublicDrawer {
  return {
    id: drawer.id,
    name: drawer.name,
    emoji: drawer.emoji ?? DEFAULT_DRAWER_EMOJI,
    locked: drawer.lock_hash !== null,
    unlocked: isUnlocked(drawer, unlocked),
    cardCount,
    subtotals,
    updated_at: drawer.updated_at,
  };
}

export async function publicDrawer(
  db: Db,
  userId: string,
  drawer: DrawerRow,
  unlocked: string[],
): Promise<PublicDrawer> {
  const [cardCount, sums] = await Promise.all([
    countDrawerCards(db, drawer.id, userId),
    sumBalanceByDrawer(db, userId),
  ]);
  const subtotals: Record<string, number> = {};
  if (isUnlocked(drawer, unlocked)) {
    for (const row of sums.results) {
      if (row.drawer_id === drawer.id) subtotals[row.currency] = row.cents;
    }
  }
  return toPublicDrawer(drawer, unlocked, cardCount, subtotals);
}

export async function drawersWithCounts(
  db: Db,
  userId: string,
  unlocked: string[],
): Promise<(DrawerRow & { cardCount: number; subtotals: Record<string, number> })[]> {
  const [{ results: drawers }, { results: counts }, { results: sums }] = await Promise.all([
    listDrawers(db, userId),
    countCardsByDrawer(db, userId),
    sumBalanceByDrawer(db, userId),
  ]);
  const byDrawer = new Map(counts.map((c) => [c.drawer_id, c.n]));
  const sumsByDrawer = new Map<string, Record<string, number>>();
  for (const row of sums) {
    const entry = sumsByDrawer.get(row.drawer_id) ?? {};
    entry[row.currency] = row.cents;
    sumsByDrawer.set(row.drawer_id, entry);
  }
  return drawers.map((d) => ({
    ...d,
    cardCount: byDrawer.get(d.id) ?? 0,
    subtotals: isUnlocked(d, unlocked) ? (sumsByDrawer.get(d.id) ?? {}) : {},
  }));
}
