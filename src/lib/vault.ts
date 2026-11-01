import { AuthError } from "./auth";
import { decryptField, encryptField } from "./crypto";
import { findCard, findDrawer, updateCardVault as updateCardVaultRow, type CardRow, type Db } from "./db";

export function normalizeVaultNumber(raw: unknown): string {
  if (typeof raw !== "string") throw new AuthError(400, "Enter the card number as 4 to 24 digits.");
  const number = raw.replace(/[\s-]/g, "");
  if (!/^\d{4,24}$/.test(number)) throw new AuthError(400, "Enter the card number as 4 to 24 digits.");
  return number;
}

export function normalizeVaultPin(raw: unknown): string {
  if (typeof raw !== "string" || !/^\d{4,12}$/.test(raw.trim())) {
    throw new AuthError(400, "Enter the PIN as 4 to 12 digits.");
  }
  return raw.trim();
}

async function ownCard(db: Db, userId: string, cardId: string): Promise<CardRow> {
  const card = await findCard(db, cardId, userId);
  if (!card) throw new AuthError(404, "That card is not on file.");
  return card;
}

async function assertSealedDrawer(db: Db, userId: string, card: CardRow, unlocked: string[]): Promise<void> {
  const drawer = card.drawer_id ? await findDrawer(db, card.drawer_id, userId) : null;
  if (!drawer?.lock_hash) {
    throw new AuthError(403, "File this card in a password-sealed drawer to use the vault.");
  }
  if (!unlocked.includes(drawer.id)) throw new AuthError(403, "Unlock this card's drawer first.");
}

export async function setVault(
  db: Db,
  userId: string,
  cardId: string,
  unlocked: string[],
  input: { number: unknown; pin: unknown },
  key: string | null,
  now = Date.now(),
): Promise<void> {
  const card = await ownCard(db, userId, cardId);
  await assertSealedDrawer(db, userId, card, unlocked);
  const number = normalizeVaultNumber(input.number);
  const pin = normalizeVaultPin(input.pin);
  await updateCardVaultRow(
    db,
    card.id,
    userId,
    await encryptField(key, userId, `vault:${card.id}:number`, number),
    await encryptField(key, userId, `vault:${card.id}:pin`, pin),
    now,
  );
}

export async function revealVault(
  db: Db,
  userId: string,
  cardId: string,
  unlocked: string[],
  key: string | null,
): Promise<{ number: string; pin: string }> {
  const card = await ownCard(db, userId, cardId);
  await assertSealedDrawer(db, userId, card, unlocked);
  if (!card.vault_number || !card.vault_pin) throw new AuthError(404, "This card has no vault yet.");
  return {
    number: await decryptField(key, userId, `vault:${card.id}:number`, card.vault_number),
    pin: await decryptField(key, userId, `vault:${card.id}:pin`, card.vault_pin),
  };
}

export async function clearVault(db: Db, userId: string, cardId: string, unlocked: string[], now = Date.now()): Promise<void> {
  const card = await ownCard(db, userId, cardId);
  const drawer = card.drawer_id ? await findDrawer(db, card.drawer_id, userId) : null;
  if (drawer?.lock_hash && !unlocked.includes(drawer.id)) {
    throw new AuthError(403, "Unlock this card's drawer first.");
  }
  await updateCardVaultRow(db, card.id, userId, null, null, now);
}
