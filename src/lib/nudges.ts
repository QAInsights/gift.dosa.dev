import { daysUntil, todayYmd } from "./cards";
import { listEmailReminders, markReminderSent, releaseReminderClaim, type Db } from "./db";
import { reminderSubject, reminderText, type Mailer } from "./email";
import { formatDate, formatMoney } from "./format";

export const LOW_BALANCE_CENTS = 500;
const LOW_COOLDOWN_MS = 7 * 86400000;
const DAY_MS = 86400000;

export interface NudgeCandidate {
  reminderId: string;
  email: string;
  retailer: string;
  balance_cents: number;
  currency: string;
  expiry: string | null;
  days_before: number;
  last_sent_at: number | null;
}

export interface PlannedNudge extends NudgeCandidate {
  reason: "expiry" | "low";
  daysUntil: number | null;
}

export function planNudges(candidates: NudgeCandidate[], today: string, now: number): PlannedNudge[] {
  const planned: PlannedNudge[] = [];
  for (const card of candidates) {
    if (card.balance_cents <= 0) continue;
    const days = card.expiry ? daysUntil(card.expiry, today) : null;
    const inWindow = days !== null && days >= 0 && days <= card.days_before;
    if (inWindow && card.expiry) {
      const windowStart = Date.parse(`${card.expiry}T00:00:00Z`) - card.days_before * DAY_MS;
      if (card.last_sent_at === null || card.last_sent_at < windowStart) {
        planned.push({ ...card, reason: "expiry", daysUntil: days });
      }
      continue;
    }
    const expired = days !== null && days < 0;
    if (!expired && card.balance_cents <= LOW_BALANCE_CENTS) {
      if (card.last_sent_at === null || now - card.last_sent_at >= LOW_COOLDOWN_MS) {
        planned.push({ ...card, reason: "low", daysUntil: days });
      }
    }
  }
  return planned;
}

export async function cronSecretMatches(provided: string | null, expected: string): Promise<boolean> {
  if (!provided || !expected) return false;
  const encode = (value: string) => new TextEncoder().encode(value);
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encode(provided)),
    crypto.subtle.digest("SHA-256", encode(expected)),
  ]);
  const left = new Uint8Array(a);
  const right = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left[i] ^ right[i];
  return diff === 0;
}

export interface DispatchResult {
  planned: number;
  sent: number;
  failed: number;
}

export async function dispatchNudges(
  db: Db,
  mailer: Mailer,
  from: string,
  today: string = todayYmd(),
  now: number = Date.now(),
): Promise<DispatchResult> {
  const { results } = await listEmailReminders(db);
  const planned = planNudges(
    results.map((r) => ({
      reminderId: r.reminder_id,
      email: r.email,
      retailer: r.retailer,
      balance_cents: r.balance_cents,
      currency: r.currency,
      expiry: r.expiry,
      days_before: r.days_before,
      last_sent_at: r.last_sent_at,
    })),
    today,
    now,
  );
  let sent = 0;
  let failed = 0;
  for (const nudge of planned) {
    const claim = await markReminderSent(db, nudge.reminderId, now, nudge.last_sent_at).catch(() => null);
    if (!claim || (claim.meta?.changes ?? 0) === 0) continue;
    const mail = {
      retailer: nudge.retailer,
      balance: formatMoney(nudge.balance_cents, nudge.currency),
      expiry: nudge.expiry ? formatDate(nudge.expiry) : null,
      daysUntil: nudge.daysUntil,
      reason: nudge.reason,
    };
    try {
      await mailer.send({ to: nudge.email, from, subject: reminderSubject(mail), text: reminderText(mail) });
      sent += 1;
    } catch {
      await releaseReminderClaim(db, nudge.reminderId, now, nudge.last_sent_at).catch(() => {});
      failed += 1;
    }
  }
  return { planned: planned.length, sent, failed };
}
