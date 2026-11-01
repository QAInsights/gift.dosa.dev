import { AuthError } from "./auth";
import { ownVisibleCard, parseBalance } from "./cards";
import {
  findLatestRedemption,
  findRedemption,
  insertRedemption,
  markRedemptionUndone,
  updateCard as updateCardRow,
  type CardRow,
  type Db,
  type RedemptionRow,
} from "./db";
import { formatMoney } from "./format";

export type SpendMode = "spent" | "remaining";

export const UNDO_WINDOW_MS = 24 * 60 * 60 * 1000;

export function canUndo(row: RedemptionRow, now: number): boolean {
  return row.undone_at === null && now - row.created_at <= UNDO_WINDOW_MS;
}

export function nextBalance(mode: unknown, amount: unknown, balanceCents: number, currency: string): number {
  if (mode !== "spent" && mode !== "remaining") {
    throw new AuthError(400, "Say whether you spent an amount or what remains.");
  }
  const cents = parseBalance(amount);
  if (mode === "spent") {
    if (cents <= 0) throw new AuthError(400, "Enter what you spent.");
    if (cents > balanceCents) {
      throw new AuthError(400, `That's more than the ${formatMoney(balanceCents, currency)} on this card.`);
    }
    return balanceCents - cents;
  }
  if (cents === balanceCents) throw new AuthError(400, "That's already the balance.");
  return cents;
}

export async function recordRedemption(
  db: Db,
  userId: string,
  cardId: string,
  unlocked: string[],
  input: { mode: unknown; amount: unknown },
  now = Date.now(),
): Promise<{ card: CardRow; redemption: RedemptionRow }> {
  const card = await ownVisibleCard(db, userId, cardId, unlocked);
  const after = nextBalance(input.mode, input.amount, card.balance_cents, card.currency);
  const redemption: RedemptionRow = {
    id: crypto.randomUUID(),
    user_id: userId,
    card_id: card.id,
    before_cents: card.balance_cents,
    after_cents: after,
    kind: "manual",
    undone_at: null,
    created_at: now,
  };
  await insertRedemption(db, redemption);
  const next: CardRow = { ...card, balance_cents: after, updated_at: now };
  await updateCardRow(db, next);
  return { card: next, redemption };
}

export async function undoRedemption(
  db: Db,
  userId: string,
  cardId: string,
  redemptionId: string,
  unlocked: string[],
  now = Date.now(),
): Promise<CardRow> {
  const card = await ownVisibleCard(db, userId, cardId, unlocked);
  const row = await findRedemption(db, redemptionId, cardId, userId);
  if (!row) throw new AuthError(404, "That update is not on file.");
  if (row.undone_at !== null) throw new AuthError(409, "Already undone.");
  const latest = await findLatestRedemption(db, cardId, userId);
  if (latest?.id !== row.id || card.balance_cents !== row.after_cents) {
    throw new AuthError(409, "The balance has changed since. Adjust it instead.");
  }
  const result = await markRedemptionUndone(db, row.id, userId, now);
  if (result.meta?.changes === 0) throw new AuthError(409, "Already undone.");
  const restored: CardRow = { ...card, balance_cents: row.before_cents, updated_at: now };
  await updateCardRow(db, restored);
  return restored;
}

export async function latestRedemption(db: Db, userId: string, cardId: string): Promise<RedemptionRow | null> {
  return findLatestRedemption(db, cardId, userId);
}
