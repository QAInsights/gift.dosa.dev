import { AuthError } from "./auth";
import {
  deleteCard as deleteCardRow,
  deleteSampleCards,
  findCard,
  findDrawer,
  insertCard,
  listDrawers,
  listUserCards,
  updateCard as updateCardRow,
  type CardRow,
  type Db,
  type DrawerRow,
} from "./db";

export type CardState = "filed" | "due" | "spent";
export const DUE_SOON_DAYS = 30;
const MAX_BALANCE_CENTS = 1000000000;

export function parseBalance(raw: unknown): number {
  if (typeof raw !== "string") throw new AuthError(400, "Enter the balance in dollars.");
  const cleaned = raw.trim().replace(/^\$/, "").replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) throw new AuthError(400, "Enter the balance like 12.50.");
  const cents = Math.round(Number(cleaned) * 100);
  if (!Number.isSafeInteger(cents) || cents > MAX_BALANCE_CENTS) {
    throw new AuthError(400, "That balance is too large.");
  }
  return cents;
}

export function normalizeRetailer(raw: unknown): string {
  if (typeof raw !== "string") throw new AuthError(400, "Name the retailer.");
  const retailer = raw.trim().replace(/\s+/g, " ");
  if (retailer.length === 0 || retailer.length > 80) {
    throw new AuthError(400, "Keep the retailer between 1 and 80 characters.");
  }
  return retailer;
}

function optionalText(raw: unknown, max: number, label: string): string | null {
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw !== "string") throw new AuthError(400, `Enter a valid ${label}.`);
  const value = raw.trim();
  if (value.length > max) throw new AuthError(400, `Keep ${label} under ${max + 1} characters.`);
  return value.length === 0 ? null : value;
}

export function normalizeLast4(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw !== "string" || !/^\d{4}$/.test(raw.trim())) {
    throw new AuthError(400, "Enter the last 4 as 4 digits.");
  }
  return raw.trim();
}

export function normalizeCurrency(raw: unknown): string {
  if (raw === undefined || raw === null || raw === "") return "USD";
  if (typeof raw !== "string" || !/^[A-Za-z]{3}$/.test(raw.trim())) {
    throw new AuthError(400, "Enter the currency as a 3-letter code.");
  }
  return raw.trim().toUpperCase();
}

export function normalizeExpiry(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new AuthError(400, "Use a date like 2027-05-03.");
  }
  const [y, m, d] = raw.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    throw new AuthError(400, "Use a real date like 2027-05-03.");
  }
  return raw;
}

export function normalizeOccasion(raw: unknown): string | null {
  return optionalText(raw, 40, "the occasion");
}

export function normalizeNickname(raw: unknown): string | null {
  return optionalText(raw, 80, "the nickname");
}

export function normalizeNotes(raw: unknown): string | null {
  return optionalText(raw, 2000, "notes");
}

export function parseTags(raw: unknown): string {
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(",") : null;
  if (list === null) throw new AuthError(400, "Enter tags as a comma-separated list.");
  const tags = [...new Set(list.map((t) => String(t).trim()).filter((t) => t.length > 0))];
  if (tags.length > 10 || tags.some((t) => t.length > 30)) {
    throw new AuthError(400, "Keep to 10 tags of 30 characters each.");
  }
  return JSON.stringify(tags);
}

export function readTags(tags: string): string[] {
  try {
    const parsed: unknown = JSON.parse(tags);
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === "string") : [];
  } catch {
    return [];
  }
}

export function todayYmd(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

export function daysUntil(expiry: string, today: string): number {
  return Math.round((Date.parse(expiry) - Date.parse(today)) / 86400000);
}

export function cardState(balanceCents: number, expiry: string | null, today: string): CardState {
  if (balanceCents <= 0) return "spent";
  if (expiry && daysUntil(expiry, today) <= DUE_SOON_DAYS) return "due";
  return "filed";
}

export interface PublicCard {
  id: string;
  drawer_id: string | null;
  retailer: string;
  nickname: string | null;
  last4: string | null;
  balance_cents: number;
  currency: string;
  expiry: string | null;
  occasion: string | null;
  tags: string[];
  notes: string | null;
  is_memory: boolean;
  sample: boolean;
  has_vault: boolean;
  state: CardState;
  created_at: number;
  updated_at: number;
}

export function toPublicCard(row: CardRow, today: string): PublicCard {
  return {
    id: row.id,
    drawer_id: row.drawer_id,
    retailer: row.retailer,
    nickname: row.nickname,
    last4: row.last4,
    balance_cents: row.balance_cents,
    currency: row.currency,
    expiry: row.expiry,
    occasion: row.occasion,
    tags: readTags(row.tags),
    notes: row.notes,
    is_memory: row.is_memory === 1,
    sample: row.sample === 1,
    has_vault: row.vault_number !== null && row.vault_pin !== null,
    state: cardState(row.balance_cents, row.expiry, today),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function resolveDrawer(db: Db, userId: string, raw: unknown): Promise<DrawerRow | null> {
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw !== "string") throw new AuthError(400, "Pick a drawer.");
  const drawer = await findDrawer(db, raw, userId);
  if (!drawer) throw new AuthError(404, "That drawer is not on file.");
  return drawer;
}

async function assertVisible(db: Db, userId: string, card: CardRow, unlocked: string[]): Promise<void> {
  if (!card.drawer_id) return;
  const drawer = await findDrawer(db, card.drawer_id, userId);
  if (drawer?.lock_hash && !unlocked.includes(drawer.id)) {
    throw new AuthError(403, "Unlock this card's drawer first.");
  }
}

async function ownVisibleCard(
  db: Db,
  userId: string,
  cardId: string,
  unlocked: string[],
): Promise<CardRow> {
  const card = await findCard(db, cardId, userId);
  if (!card) throw new AuthError(404, "That card is not on file.");
  await assertVisible(db, userId, card, unlocked);
  return card;
}

export interface CardInput {
  drawer_id?: unknown;
  retailer: unknown;
  nickname?: unknown;
  last4?: unknown;
  balance: unknown;
  currency?: unknown;
  expiry?: unknown;
  occasion?: unknown;
  tags?: unknown;
  notes?: unknown;
}

export async function createCard(
  db: Db,
  userId: string,
  input: CardInput,
  unlocked: string[] = [],
  now = Date.now(),
  sample = false,
): Promise<CardRow> {
  const drawer = await resolveDrawer(db, userId, input.drawer_id);
  if (drawer?.lock_hash && !unlocked.includes(drawer.id)) {
    throw new AuthError(403, "Unlock the drawer first.");
  }
  const row: CardRow = {
    id: crypto.randomUUID(),
    user_id: userId,
    drawer_id: drawer?.id ?? null,
    retailer: normalizeRetailer(input.retailer),
    nickname: normalizeNickname(input.nickname),
    last4: normalizeLast4(input.last4),
    balance_cents: parseBalance(input.balance),
    currency: normalizeCurrency(input.currency),
    expiry: normalizeExpiry(input.expiry),
    occasion: normalizeOccasion(input.occasion),
    tags: parseTags(input.tags ?? ""),
    notes: normalizeNotes(input.notes),
    receipt_url: null,
    is_memory: 0,
    sample: sample ? 1 : 0,
    vault_number: null,
    vault_pin: null,
    created_at: now,
    updated_at: now,
  };
  await insertCard(db, row);
  return row;
}

export type CardPatch = Partial<CardInput> & { is_memory?: unknown };

export async function updateCard(
  db: Db,
  userId: string,
  cardId: string,
  unlocked: string[],
  patch: CardPatch,
  now = Date.now(),
): Promise<CardRow> {
  const card = await ownVisibleCard(db, userId, cardId, unlocked);
  const oldDrawer = card.drawer_id ? await findDrawer(db, card.drawer_id, userId) : null;
  const newDrawer = patch.drawer_id === undefined ? oldDrawer : await resolveDrawer(db, userId, patch.drawer_id);
  if (newDrawer?.lock_hash && !unlocked.includes(newDrawer.id)) {
    throw new AuthError(403, "Unlock the target drawer first.");
  }
  const leavingSeal = oldDrawer?.lock_hash && (!newDrawer || !newDrawer.lock_hash);
  if (leavingSeal && (card.vault_number || card.vault_pin)) {
    throw new AuthError(409, "Clear the vault before moving this card out of a sealed drawer.");
  }
  const next: CardRow = {
    ...card,
    drawer_id: newDrawer?.id ?? null,
    retailer: patch.retailer === undefined ? card.retailer : normalizeRetailer(patch.retailer),
    nickname: patch.nickname === undefined ? card.nickname : normalizeNickname(patch.nickname),
    last4: patch.last4 === undefined ? card.last4 : normalizeLast4(patch.last4),
    balance_cents: patch.balance === undefined ? card.balance_cents : parseBalance(patch.balance),
    currency: patch.currency === undefined ? card.currency : normalizeCurrency(patch.currency),
    expiry: patch.expiry === undefined ? card.expiry : normalizeExpiry(patch.expiry),
    occasion: patch.occasion === undefined ? card.occasion : normalizeOccasion(patch.occasion),
    tags: patch.tags === undefined ? card.tags : parseTags(patch.tags),
    notes: patch.notes === undefined ? card.notes : normalizeNotes(patch.notes),
    is_memory: patch.is_memory === undefined ? card.is_memory : normalizeMemory(patch.is_memory),
    updated_at: now,
  };
  await updateCardRow(db, next);
  return next;
}

export function normalizeMemory(raw: unknown): number {
  if (raw === true || raw === 1) return 1;
  if (raw === false || raw === 0) return 0;
  throw new AuthError(400, "Mark the card as a memory or not.");
}

export async function visibleCard(
  db: Db,
  userId: string,
  cardId: string,
  unlocked: string[],
  today: string,
): Promise<PublicCard> {
  const card = await ownVisibleCard(db, userId, cardId, unlocked);
  return toPublicCard(card, today);
}

export async function deleteCard(db: Db, userId: string, cardId: string, unlocked: string[]): Promise<void> {
  const card = await ownVisibleCard(db, userId, cardId, unlocked);
  if (card.is_memory === 1) {
    throw new AuthError(409, "Memories are keepsakes. Unmark it as a memory first.");
  }
  await deleteCardRow(db, card.id, userId);
}

export async function clearSamples(db: Db, userId: string): Promise<number> {
  const { results } = await listUserCards(db, userId);
  const samples = results.filter((c) => c.sample === 1);
  if (samples.length === 0) return 0;
  await deleteSampleCards(db, userId);
  return samples.length;
}

export interface CabinetQuery {
  q?: string;
  drawer?: string;
  state?: string;
  memories?: boolean;
  sort?: string;
}

export async function listCabinet(
  db: Db,
  userId: string,
  unlocked: string[],
  query: CabinetQuery,
  today: string,
): Promise<{ cards: PublicCard[]; sealedCount: number }> {
  const [{ results }, { results: drawers }] = await Promise.all([listUserCards(db, userId), listDrawers(db, userId)]);
  const locked = new Set(drawers.filter((d) => d.lock_hash && !unlocked.includes(d.id)).map((d) => d.id));
  const visible = results.filter((c) => !c.drawer_id || !locked.has(c.drawer_id));
  const hidden = results.filter((c) => c.drawer_id && locked.has(c.drawer_id));
  const sealedCount = !query.drawer
    ? hidden.length
    : query.drawer === "personal"
      ? 0
      : hidden.filter((c) => c.drawer_id === query.drawer).length;
  const q = (query.q ?? "").trim().toLowerCase();
  const cards = visible
    .map((c) => toPublicCard(c, today))
    .filter((c) => {
      if (query.memories && !c.is_memory) return false;
      if (query.drawer === "personal" && c.drawer_id !== null) return false;
      if (query.drawer && query.drawer !== "personal" && c.drawer_id !== query.drawer) return false;
      if (query.state === "filed" || query.state === "due" || query.state === "spent") {
        if (c.state !== query.state) return false;
      }
      if (!q) return true;
      const hay = [c.retailer, c.nickname ?? "", c.occasion ?? "", c.notes ?? "", ...c.tags]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    })
    .sort((a, b) => {
      if (query.sort === "expiry") {
        if (!a.expiry) return 1;
        if (!b.expiry) return -1;
        return a.expiry < b.expiry ? -1 : 1;
      }
      if (query.sort === "balance") return b.balance_cents - a.balance_cents;
      if (query.sort === "retailer") return a.retailer.localeCompare(b.retailer);
      return b.created_at - a.created_at;
    });
  return { cards, sealedCount };
}

export function pickSpendNext(cards: CardRow[], today: string): CardRow | null {
  const candidates = cards.filter((c) => c.balance_cents > 0 && c.is_memory !== 1);
  candidates.sort((a, b) => {
    const da = a.expiry ? daysUntil(a.expiry, today) : Number.POSITIVE_INFINITY;
    const db = b.expiry ? daysUntil(b.expiry, today) : Number.POSITIVE_INFINITY;
    if (da !== db) return da - db;
    return b.balance_cents - a.balance_cents;
  });
  return candidates[0] ?? null;
}

export interface Dashboard {
  totals: Record<string, number>;
  cardCount: number;
  dues: Record<string, number>;
  dueCount: number;
  expiring: { id: string; retailer: string; balance_cents: number; currency: string; expiry: string }[];
  sealedCount: number;
  sampleCount: number;
  spendNext: { id: string; retailer: string; balance_cents: number; currency: string; expiry: string | null } | null;
}

export async function dashboard(db: Db, userId: string, unlocked: string[], today: string): Promise<Dashboard> {
  const [{ results }, { results: drawers }] = await Promise.all([listUserCards(db, userId), listDrawers(db, userId)]);
  const locked = new Set(drawers.filter((d) => d.lock_hash && !unlocked.includes(d.id)).map((d) => d.id));
  const totals: Record<string, number> = {};
  const dues: Record<string, number> = {};
  let dueCount = 0;
  let sealedCount = 0;
  let sampleCount = 0;
  const open: CardRow[] = [];
  const expiring: Dashboard["expiring"] = [];
  for (const card of results) {
    const state = cardState(card.balance_cents, card.expiry, today);
    if (card.sample === 1) sampleCount += 1;
    if (state === "due") dueCount += 1;
    if (card.drawer_id && locked.has(card.drawer_id)) {
      sealedCount += 1;
      continue;
    }
    open.push(card);
    totals[card.currency] = (totals[card.currency] ?? 0) + card.balance_cents;
    if (state === "due") {
      dues[card.currency] = (dues[card.currency] ?? 0) + card.balance_cents;
      if (card.expiry) {
        expiring.push({
          id: card.id,
          retailer: card.retailer,
          balance_cents: card.balance_cents,
          currency: card.currency,
          expiry: card.expiry,
        });
      }
    }
  }
  expiring.sort((a, b) => (a.expiry < b.expiry ? -1 : 1));
  const next = pickSpendNext(open, today);
  return {
    totals,
    cardCount: results.length,
    dues,
    dueCount,
    expiring: expiring.slice(0, 5),
    sealedCount,
    sampleCount,
    spendNext: next
      ? { id: next.id, retailer: next.retailer, balance_cents: next.balance_cents, currency: next.currency, expiry: next.expiry }
      : null,
  };
}
