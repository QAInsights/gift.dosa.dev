import { AuthError } from "./auth";
import { deleteCardReminders, findCard, findCardReminder, insertReminder, type Db } from "./db";

export interface ReminderOption {
  days: number | null;
  label: string;
}

export const REMINDER_OPTIONS: ReminderOption[] = [
  { days: null, label: "Off" },
  { days: 0, label: "On the day it expires" },
  { days: 3, label: "3 days before" },
  { days: 7, label: "A week before" },
  { days: 14, label: "2 weeks before" },
  { days: 30, label: "A month before" },
];

export function reminderLabel(days: number | null): string {
  return REMINDER_OPTIONS.find((o) => o.days === days)?.label ?? "Off";
}

export function normalizeLeadDays(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === "") return null;
  const days =
    typeof raw === "number" ? raw : typeof raw === "string" && /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : NaN;
  if (!REMINDER_OPTIONS.some((o) => o.days === days)) {
    throw new AuthError(400, "Pick one of the reminder times.");
  }
  return days;
}

export async function setCardReminder(
  db: Db,
  userId: string,
  cardId: string,
  rawLead: unknown,
  now = Date.now(),
): Promise<number | null> {
  const card = await findCard(db, cardId, userId);
  if (!card) throw new AuthError(404, "That card is not on file.");
  const days = normalizeLeadDays(rawLead);
  const existing = await findCardReminder(db, cardId, userId);
  if (days === null) {
    if (existing) await deleteCardReminders(db, cardId, userId);
    return null;
  }
  if (existing && existing.days_before === days) return days;
  await deleteCardReminders(db, cardId, userId);
  await insertReminder(db, {
    id: crypto.randomUUID(),
    user_id: userId,
    card_id: cardId,
    days_before: days,
    channel: "email",
    last_sent_at: null,
    created_at: now,
  });
  return days;
}

export async function getCardReminder(db: Db, userId: string, cardId: string): Promise<number | null> {
  const row = await findCardReminder(db, cardId, userId);
  return row ? row.days_before : null;
}
