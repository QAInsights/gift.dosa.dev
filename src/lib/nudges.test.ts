import { describe, expect, it } from "vitest";
import { createCard, updateCard } from "./cards";
import { createDrawer } from "./drawers";
import type { Mailer } from "./email";
import { FakeDb } from "./fake-db";
import { cronSecretMatches, dispatchNudges, planNudges, type NudgeCandidate } from "./nudges";
import { setCardReminder } from "./reminders";

const TODAY = "2026-10-30";
const NOW = Date.parse("2026-10-30T12:00:00Z");
const USER = "u-nudge";
const DAY = 86400000;

function candidate(patch: Partial<NudgeCandidate> = {}): NudgeCandidate {
  return {
    reminderId: "r1",
    email: "ada@test.dev",
    retailer: "Mart",
    balance_cents: 2500,
    currency: "USD",
    expiry: "2026-11-06",
    days_before: 7,
    last_sent_at: null,
    ...patch,
  };
}

describe("planNudges", () => {
  it("dues an expiry nudge when the lead window opens, not before", () => {
    expect(planNudges([candidate()], TODAY, NOW).map((n) => n.reason)).toEqual(["expiry"]);
    expect(planNudges([candidate({ expiry: "2026-11-07" })], TODAY, NOW)).toEqual([]);
    expect(planNudges([candidate({ expiry: "2026-10-30", days_before: 0 })], TODAY, NOW)).toHaveLength(1);
  });

  it("stays quiet for spent, expired, and healthy cards", () => {
    expect(planNudges([candidate({ balance_cents: 0 })], TODAY, NOW)).toEqual([]);
    expect(planNudges([candidate({ expiry: "2026-10-29" })], TODAY, NOW)).toEqual([]);
    expect(planNudges([candidate({ expiry: "2027-06-01", balance_cents: 9000 })], TODAY, NOW)).toEqual([]);
  });

  it("sends once per expiry window, then again if the expiry moves", () => {
    expect(planNudges([candidate({ last_sent_at: NOW })], TODAY, NOW)).toEqual([]);
    const moved = planNudges([candidate({ expiry: "2026-12-06", days_before: 7, last_sent_at: NOW })], "2026-11-29", NOW + 30 * DAY);
    expect(moved.map((n) => n.reason)).toEqual(["expiry"]);
  });

  it("never nudges expired low balances or repeats low inside the expiry window", () => {
    expect(planNudges([candidate({ expiry: "2026-10-29", balance_cents: 400 })], TODAY, NOW)).toEqual([]);
    expect(planNudges([candidate({ balance_cents: 400, days_before: 30, last_sent_at: NOW })], TODAY, NOW)).toEqual([]);
  });

  it("nudges low balances on a cooldown and prefers the expiry reason", () => {
    const low = candidate({ expiry: "2027-06-01", balance_cents: 400 });
    expect(planNudges([low], TODAY, NOW).map((n) => n.reason)).toEqual(["low"]);
    expect(planNudges([{ ...low, last_sent_at: NOW - DAY }], TODAY, NOW)).toEqual([]);
    expect(planNudges([{ ...low, last_sent_at: NOW - 8 * DAY }], TODAY, NOW)).toHaveLength(1);
    const both = candidate({ balance_cents: 400 });
    expect(planNudges([both], TODAY, NOW).map((n) => n.reason)).toEqual(["expiry"]);
  });
});

describe("cronSecretMatches", () => {
  it("accepts only the exact secret", async () => {
    await expect(cronSecretMatches("s3cret-value", "s3cret-value")).resolves.toBe(true);
    await expect(cronSecretMatches("s3cret-valuf", "s3cret-value")).resolves.toBe(false);
    await expect(cronSecretMatches("", "s3cret-value")).resolves.toBe(false);
    await expect(cronSecretMatches(null, "s3cret-value")).resolves.toBe(false);
  });
});

describe("dispatchNudges", () => {
  function recordingMailer(failFor?: string): { mailer: Mailer; sent: { to: string; subject: string; text: string }[] } {
    const sent: { to: string; subject: string; text: string }[] = [];
    const mailer: Mailer = {
      async send(message) {
        if (message.to === failFor) throw new Error("mailbox full");
        sent.push(message);
      },
    };
    return { mailer, sent };
  }

  async function seededDb(): Promise<FakeDb> {
    const db = new FakeDb();
    db.users.push(
      { id: USER, email: "ada@test.dev", name: "Ada", created_at: NOW, updated_at: NOW },
      { id: "u2", email: "bo@test.dev", name: null, created_at: NOW, updated_at: NOW },
    );
    const due = await createCard(db, USER, { retailer: "Mart", balance: "25.00", expiry: "2026-11-05" }, [], NOW);
    await setCardReminder(db, USER, due.id, "7", NOW);
    const low = await createCard(db, "u2", { retailer: "Cafe", balance: "3.00", expiry: "2027-06-01" }, [], NOW);
    await setCardReminder(db, "u2", low.id, "7", NOW);
    const quiet = await createCard(db, USER, { retailer: "Books", balance: "50.00", expiry: "2027-06-01" }, [], NOW);
    await setCardReminder(db, USER, quiet.id, "7", NOW);
    return db;
  }

  it("emails due owners, marks them sent, and stays quiet on a second run", async () => {
    const db = await seededDb();
    const { mailer, sent } = recordingMailer();
    const first = await dispatchNudges(db, mailer, "cabinet@gift.dosa.dev", TODAY, NOW);
    expect(first).toEqual({ planned: 2, sent: 2, failed: 0 });
    expect(sent.map((m) => m.to).sort()).toEqual(["ada@test.dev", "bo@test.dev"]);
    const mart = sent.find((m) => m.to === "ada@test.dev");
    expect(mart?.subject).toContain("Mart");
    expect(mart?.text).toContain("$25.00");
    expect(mart?.text).toContain("Nov 5, 2026");
    expect(mart?.text).not.toContain("vault");
    const second = await dispatchNudges(db, mailer, "cabinet@gift.dosa.dev", TODAY, NOW);
    expect(second).toEqual({ planned: 0, sent: 0, failed: 0 });
    expect(sent).toHaveLength(2);
  });

  it("skips memories, samples, and sealed-drawer cards", async () => {
    const db = new FakeDb();
    db.users.push({ id: USER, email: "ada@test.dev", name: null, created_at: NOW, updated_at: NOW });
    const memory = await createCard(db, USER, { retailer: "Keepsake", balance: "25.00", expiry: "2026-11-05" }, [], NOW);
    await setCardReminder(db, USER, memory.id, "7", NOW);
    await updateCard(db, USER, memory.id, [], { is_memory: true }, NOW);
    const sample = await createCard(db, USER, { retailer: "Steam", balance: "50.00", expiry: "2026-11-05" }, [], NOW, true);
    await setCardReminder(db, USER, sample.id, "7", NOW);
    const sealed = await createDrawer(db, USER, "Gifts", "drawer-secret", NOW);
    const hidden = await createCard(db, USER, { retailer: "Secret", balance: "25.00", expiry: "2026-11-05", drawer_id: sealed.id }, [sealed.id], NOW);
    await setCardReminder(db, USER, hidden.id, "7", NOW);
    const { mailer, sent } = recordingMailer();
    const result = await dispatchNudges(db, mailer, "cabinet@gift.dosa.dev", TODAY, NOW);
    expect(result).toEqual({ planned: 0, sent: 0, failed: 0 });
    expect(sent).toHaveLength(0);
  });

  it("overlapping runs never email the same reminder twice", async () => {
    const db = await seededDb();
    let sends = 0;
    const slow: Mailer = {
      async send() {
        sends += 1;
        await new Promise((resolve) => setTimeout(resolve, 5));
      },
    };
    const [a, b] = await Promise.all([
      dispatchNudges(db, slow, "cabinet@gift.dosa.dev", TODAY, NOW),
      dispatchNudges(db, slow, "cabinet@gift.dosa.dev", TODAY, NOW),
    ]);
    expect(sends).toBe(2);
    expect(a.sent + b.sent).toBe(2);
  });

  it("keeps going when one mailbox fails and leaves it unmarked for the next run", async () => {
    const db = await seededDb();
    const { mailer, sent } = recordingMailer("bo@test.dev");
    const result = await dispatchNudges(db, mailer, "cabinet@gift.dosa.dev", TODAY, NOW);
    expect(result).toEqual({ planned: 2, sent: 1, failed: 1 });
    expect(sent.map((m) => m.to)).toEqual(["ada@test.dev"]);
    const retry = await dispatchNudges(db, recordingMailer().mailer, "cabinet@gift.dosa.dev", TODAY, NOW);
    expect(retry).toEqual({ planned: 1, sent: 1, failed: 0 });
  });
});
