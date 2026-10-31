import { describe, expect, it } from "vitest";
import { createCard, deleteCard, updateCard } from "./cards";
import { FakeDb, expectAuthError } from "./fake-db";
import { getCardReminder, normalizeLeadDays, reminderLabel, setCardReminder } from "./reminders";

const USER = "u-remind";

describe("normalizeLeadDays", () => {
  it("accepts the offered set and off", () => {
    expect(normalizeLeadDays("")).toBeNull();
    expect(normalizeLeadDays(undefined)).toBeNull();
    expect(normalizeLeadDays("0")).toBe(0);
    expect(normalizeLeadDays(7)).toBe(7);
    expect(normalizeLeadDays("30")).toBe(30);
  });

  it("rejects anything else", async () => {
    await expectAuthError((async () => normalizeLeadDays("5"))(), 400);
    await expectAuthError((async () => normalizeLeadDays(-1))(), 400);
  });
});

describe("card reminders", () => {
  it("stores, replaces, and clears the lead time", async () => {
    const db = new FakeDb();
    const card = await createCard(db, USER, { retailer: "Mart", balance: "10.00", expiry: "2027-01-01", reminder: "7" });
    await expect(getCardReminder(db, USER, card.id)).resolves.toBe(7);
    await setCardReminder(db, USER, card.id, "3");
    await expect(getCardReminder(db, USER, card.id)).resolves.toBe(3);
    expect(db.reminders).toHaveLength(1);
    await setCardReminder(db, USER, card.id, "");
    await expect(getCardReminder(db, USER, card.id)).resolves.toBeNull();
    expect(db.reminders).toHaveLength(0);
  });

  it("round-trips through updateCard and stays per-user", async () => {
    const db = new FakeDb();
    const card = await createCard(db, USER, { retailer: "Mart", balance: "10.00" });
    await expect(getCardReminder(db, USER, card.id)).resolves.toBeNull();
    await updateCard(db, USER, card.id, [], { reminder: "14" });
    await expect(getCardReminder(db, USER, card.id)).resolves.toBe(14);
    await expect(getCardReminder(db, "someone-else", card.id)).resolves.toBeNull();
    await expectAuthError(setCardReminder(db, "someone-else", card.id, "7"), 404);
  });
});

describe("reminder re-arm rules", () => {
  it("keeps the sent mark when the same lead is saved again, resets on a new lead", async () => {
    const db = new FakeDb();
    const card = await createCard(db, USER, { retailer: "Mart", balance: "10.00", expiry: "2027-01-01", reminder: "7" });
    db.reminders[0].last_sent_at = 4242;
    await setCardReminder(db, USER, card.id, "7");
    expect(db.reminders).toHaveLength(1);
    expect(db.reminders[0].last_sent_at).toBe(4242);
    await setCardReminder(db, USER, card.id, "3");
    expect(db.reminders).toHaveLength(1);
    expect(db.reminders[0].last_sent_at).toBeNull();
  });

  it("rejects an invalid reminder without filing the card", async () => {
    const db = new FakeDb();
    await expectAuthError(createCard(db, USER, { retailer: "Mart", balance: "10.00", reminder: "5" }), 400);
    expect(db.cards).toHaveLength(0);
  });

  it("re-arms a sent reminder when the expiry changes", async () => {
    const db = new FakeDb();
    const card = await createCard(db, USER, { retailer: "Mart", balance: "10.00", expiry: "2027-02-01", reminder: "30" });
    db.reminders[0].last_sent_at = 4242;
    await updateCard(db, USER, card.id, [], { expiry: "2026-11-05" });
    expect(db.reminders[0].last_sent_at).toBeNull();
  });

  it("removes the reminder when the card is deleted", async () => {
    const db = new FakeDb();
    const card = await createCard(db, USER, { retailer: "Mart", balance: "10.00", reminder: "7" });
    await deleteCard(db, USER, card.id, []);
    expect(db.reminders).toHaveLength(0);
    await expect(getCardReminder(db, USER, card.id)).resolves.toBeNull();
  });
});

describe("reminderLabel", () => {
  it("reads back in filing words", () => {
    expect(reminderLabel(null)).toBe("Off");
    expect(reminderLabel(0)).toBe("On the day it expires");
    expect(reminderLabel(7)).toBe("A week before");
  });
});
