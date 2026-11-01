import { beforeEach, describe, expect, it } from "vitest";
import {
  cardState,
  createCard,
  dashboard,
  daysUntil,
  deleteCard,
  listCabinet,
  normalizeCurrency,
  normalizeExpiry,
  normalizeLast4,
  normalizeRetailer,
  parseBalance,
  parseTags,
  recentActivity,
  toPublicCard,
  updateCard,
} from "./cards";
import { createDrawer } from "./drawers";
import { FakeDb, expectAuthError } from "./fake-db";
import { setVault } from "./vault";

const NOW = 1_790_000_000_000;
const TODAY = "2026-10-30";
const USER = "u1";
const PASS = "drawer-secret";
let db: FakeDb;

beforeEach(() => {
  db = new FakeDb();
});

async function sealedDrawer(): Promise<string> {
  const drawer = await createDrawer(db, USER, "Gifts", PASS, NOW);
  return drawer.id;
}

describe("validators", () => {
  it("parses dollars to cents", () => {
    expect(parseBalance("12.50")).toBe(1250);
    expect(parseBalance("$1,234.56")).toBe(123456);
    expect(parseBalance("0")).toBe(0);
  });

  it.each([[""], ["abc"], ["12.999"], ["-5"], ["$"], [null], [42]])("rejects balance %s", (raw) => {
    expect(() => parseBalance(raw)).toThrow();
  });

  it("validates retailer, last4, currency, and expiry", () => {
    expect(normalizeRetailer("  Mart  ")).toBe("Mart");
    expect(() => normalizeRetailer("")).toThrow();
    expect(normalizeLast4("4402")).toBe("4402");
    expect(normalizeLast4("")).toBeNull();
    expect(() => normalizeLast4("44")).toThrow();
    expect(normalizeCurrency("usd")).toBe("USD");
    expect(normalizeCurrency("")).toBe("USD");
    expect(normalizeExpiry("2027-05-03")).toBe("2027-05-03");
    expect(normalizeExpiry("")).toBeNull();
    expect(() => normalizeExpiry("2027-02-30")).toThrow();
    expect(() => normalizeExpiry("May 3")).toThrow();
    expect(normalizeExpiry("2026-10-30", "2026-10-30")).toBe("2026-10-30");
    expect(normalizeExpiry("2026-10-29", "2026-10-30")).toBe("2026-10-29");
    expect(() => normalizeExpiry("2026-10-28", "2026-10-30")).toThrow();
  });

  it("parses tags from strings and arrays", () => {
    expect(parseTags("food, weekly, food")).toBe('["food","weekly"]');
    expect(parseTags(["a", "b"])).toBe('["a","b"]');
    expect(parseTags("")).toBe("[]");
    expect(() => parseTags("x".repeat(31))).toThrow();
  });
});

describe("cardState", () => {
  it("derives spent, due, and filed", () => {
    expect(cardState(0, "2027-05-03", TODAY)).toBe("spent");
    expect(cardState(1200, "2026-11-15", TODAY)).toBe("due");
    expect(cardState(1200, "2026-10-01", TODAY)).toBe("due");
    expect(cardState(1200, "2027-05-03", TODAY)).toBe("filed");
    expect(cardState(1200, null, TODAY)).toBe("filed");
  });

  it("counts days on calendar boundaries", () => {
    expect(daysUntil("2026-10-30", TODAY)).toBe(0);
    expect(daysUntil("2026-11-29", TODAY)).toBe(30);
  });
});

describe("createCard and updateCard", () => {
  it("creates with defaults and resolves drawers", async () => {
    const drawer = await createDrawer(db, USER, "Food", null, NOW);
    const card = await createCard(db, USER, {
      retailer: "Mart",
      balance: "12.00",
      drawer_id: drawer.id,
      tags: "food",
    });
    expect(card.balance_cents).toBe(1200);
    expect(card.currency).toBe("USD");
    expect(card.tags).toBe('["food"]');
    expect(card.is_memory).toBe(0);
    await expectAuthError(createCard(db, USER, { retailer: "X", balance: "1.00", drawer_id: "missing" }), 404);
  });

  it("rejects an expiry in the past", async () => {
    await expectAuthError(
      createCard(db, USER, { retailer: "Mart", balance: "1.00", expiry: "2020-01-01" }, [], NOW),
      400,
    );
  });

  it("refuses to file into a sealed drawer", async () => {
    const drawerId = await sealedDrawer();
    await expectAuthError(
      createCard(db, USER, { retailer: "Mart", balance: "1.00", drawer_id: drawerId }),
      403,
    );
    const card = await createCard(db, USER, { retailer: "Mart", balance: "1.00", drawer_id: drawerId }, [drawerId]);
    expect(card.drawer_id).toBe(drawerId);
  });

  it("patches fields and toggles memory", async () => {
    const card = await createCard(db, USER, { retailer: "Mart", balance: "12.00" });
    const next = await updateCard(db, USER, card.id, [], { balance: "8.00", is_memory: true });
    expect(next.balance_cents).toBe(800);
    expect(next.is_memory).toBe(1);
    expect(next.retailer).toBe("Mart");
    await expectAuthError(updateCard(db, USER, "missing", [], { balance: "1.00" }), 404);
  });

  it("blocks edits on sealed cards", async () => {
    const drawerId = await sealedDrawer();
    const card = await createCard(db, USER, { retailer: "Mart", balance: "12.00", drawer_id: drawerId }, [drawerId]);
    await expectAuthError(updateCard(db, USER, card.id, [], { balance: "1.00" }), 403);
    const next = await updateCard(db, USER, card.id, [drawerId], { balance: "1.00" });
    expect(next.balance_cents).toBe(100);
  });

  it("gates drawer moves at both ends", async () => {
    const sealed = await sealedDrawer();
    const open = await createDrawer(db, USER, "Food", null, NOW);
    const card = await createCard(db, USER, { retailer: "Mart", balance: "12.00" });
    await expectAuthError(updateCard(db, USER, card.id, [], { drawer_id: sealed }), 403);
    const moved = await updateCard(db, USER, card.id, [sealed], { drawer_id: sealed });
    expect(moved.drawer_id).toBe(sealed);
    await setVault(db, USER, moved.id, [sealed], { number: "41112222", pin: "9021" });
    await expectAuthError(updateCard(db, USER, moved.id, [sealed], { drawer_id: open.id }), 409);
    await expectAuthError(updateCard(db, USER, moved.id, [sealed], { drawer_id: null }), 409);
  });
});

describe("deleteCard", () => {
  it("deletes plain cards, keeps memories", async () => {
    const card = await createCard(db, USER, { retailer: "Mart", balance: "12.00" });
    await updateCard(db, USER, card.id, [], { is_memory: true });
    await expectAuthError(deleteCard(db, USER, card.id, []), 409);
    await updateCard(db, USER, card.id, [], { is_memory: false });
    await deleteCard(db, USER, card.id, []);
    expect(db.cards).toHaveLength(0);
  });

  it("blocks deletes on sealed cards", async () => {
    const drawerId = await sealedDrawer();
    const card = await createCard(db, USER, { retailer: "Mart", balance: "12.00", drawer_id: drawerId }, [drawerId]);
    await expectAuthError(deleteCard(db, USER, card.id, []), 403);
  });
});

describe("listCabinet", () => {
  async function seed(): Promise<{ food: string }> {
    const food = await createDrawer(db, USER, "Food", null, NOW);
    await createCard(db, USER, { retailer: "Mart", balance: "12.00", expiry: "2026-11-05", drawer_id: food.id, tags: "weekly" }, [], NOW);
    await createCard(db, USER, { retailer: "Books", balance: "50.00", expiry: "2027-06-01", notes: "birthday gift" }, [], NOW);
    await createCard(db, USER, { retailer: "Cafe", balance: "0.00" });
    return { food: food.id };
  }

  it("searches, filters, and sorts", async () => {
    const { food } = await seed();
    const searched = await listCabinet(db, USER, [], { q: "birthday" }, TODAY);
    expect(searched.cards.map((c) => c.retailer)).toEqual(["Books"]);
    const filed = await listCabinet(db, USER, [], { drawer: food }, TODAY);
    expect(filed.cards.map((c) => c.retailer)).toEqual(["Mart"]);
    const personal = await listCabinet(db, USER, [], { drawer: "personal" }, TODAY);
    expect(personal.cards).toHaveLength(2);
    const due = await listCabinet(db, USER, [], { state: "due" }, TODAY);
    expect(due.cards.map((c) => c.retailer)).toEqual(["Mart"]);
    const byBalance = await listCabinet(db, USER, [], { sort: "balance" }, TODAY);
    expect(byBalance.cards.map((c) => c.retailer)).toEqual(["Books", "Mart", "Cafe"]);
  });

  it("hides sealed cards and counts them per drawer filter", async () => {
    const drawerId = await sealedDrawer();
    await createCard(db, USER, { retailer: "Secret", balance: "99.00", drawer_id: drawerId }, [drawerId]);
    await createCard(db, USER, { retailer: "Open", balance: "1.00" });
    const sealed = await listCabinet(db, USER, [], {}, TODAY);
    expect(sealed.cards.map((c) => c.retailer)).toEqual(["Open"]);
    expect(sealed.sealedCount).toBe(1);
    const filtered = await listCabinet(db, USER, [], { drawer: drawerId }, TODAY);
    expect(filtered.cards).toHaveLength(0);
    expect(filtered.sealedCount).toBe(1);
    const other = await listCabinet(db, USER, [], { drawer: "personal" }, TODAY);
    expect(other.sealedCount).toBe(0);
    const open = await listCabinet(db, USER, [drawerId], {}, TODAY);
    expect(open.cards).toHaveLength(2);
    expect(open.sealedCount).toBe(0);
  });

  it("filters memories only", async () => {
    const card = await createCard(db, USER, { retailer: "Mart", balance: "12.00" });
    await createCard(db, USER, { retailer: "Books", balance: "5.00" });
    await updateCard(db, USER, card.id, [], { is_memory: true });
    const memories = await listCabinet(db, USER, [], { memories: true }, TODAY);
    expect(memories.cards.map((c) => c.retailer)).toEqual(["Mart"]);
  });
});

describe("dashboard", () => {
  it("totals visible money per currency, counts everything", async () => {
    const drawerId = await sealedDrawer();
    await createCard(db, USER, { retailer: "Secret", balance: "99.00", expiry: "2026-11-01", drawer_id: drawerId }, [drawerId], NOW);
    await createCard(db, USER, { retailer: "Open", balance: "1.00", expiry: "2026-11-02" }, [], NOW);
    await createCard(db, USER, { retailer: "Euro", balance: "8.00", currency: "EUR" });
    const dash = await dashboard(db, USER, [], TODAY);
    expect(dash.totals).toEqual({ USD: 100, EUR: 800 });
    expect(dash.cardCount).toBe(3);
    expect(dash.dues).toEqual({ USD: 100 });
    expect(dash.dueCount).toBe(2);
    expect(dash.sealedCount).toBe(1);
    expect(dash.expiring.map((c) => c.retailer)).toEqual(["Open"]);
  });

  it("suggests spending the soonest-expiring open card first", async () => {
    await createCard(db, USER, { retailer: "Later", balance: "80.00", expiry: "2027-06-01" }, [], NOW);
    await createCard(db, USER, { retailer: "Sooner", balance: "5.00", expiry: "2026-11-05" }, [], NOW);
    await createCard(db, USER, { retailer: "Spent", balance: "0.00", expiry: "2026-11-01" }, [], NOW);
    const dash = await dashboard(db, USER, [], TODAY);
    expect(dash.spendNext?.retailer).toBe("Sooner");
  });

  it("spend-next ignores memories and sealed cards, falls back to biggest balance", async () => {
    const drawerId = await sealedDrawer();
    await createCard(db, USER, { retailer: "Sealed", balance: "99.00", expiry: "2026-11-01", drawer_id: drawerId }, [drawerId], NOW);
    const keepsake = await createCard(db, USER, { retailer: "Keepsake", balance: "50.00", expiry: "2026-11-02" }, [], NOW);
    await updateCard(db, USER, keepsake.id, [], { is_memory: true });
    await createCard(db, USER, { retailer: "Big", balance: "40.00" });
    await createCard(db, USER, { retailer: "Small", balance: "4.00" });
    const dash = await dashboard(db, USER, [], TODAY);
    expect(dash.spendNext?.retailer).toBe("Big");
  });
});

describe("recentActivity", () => {
  it("orders by last update, hides sealed cards, and caps the list", async () => {
    const drawerId = await sealedDrawer();
    await createCard(db, USER, { retailer: "Old", balance: "1.00" }, [], NOW);
    const fresh = await createCard(db, USER, { retailer: "Fresh", balance: "2.00" }, [], NOW + 1000);
    await createCard(db, USER, { retailer: "Secret", balance: "9.00", drawer_id: drawerId }, [drawerId], NOW + 2000);
    await updateCard(db, USER, fresh.id, [], { balance: "3.00" }, NOW + 9000);
    const recent = await recentActivity(db, USER, [], TODAY);
    expect(recent.map((c) => c.retailer)).toEqual(["Fresh", "Old"]);
    const unlocked = await recentActivity(db, USER, [drawerId], TODAY, 2);
    expect(unlocked.map((c) => c.retailer)).toEqual(["Fresh", "Secret"]);
  });

  it("is empty for a fresh account", async () => {
    await expect(recentActivity(db, USER, [], TODAY)).resolves.toEqual([]);
  });
});

describe("toPublicCard", () => {
  it("strips vault values and derives state", async () => {
    const card = await createCard(db, USER, { retailer: "Mart", balance: "0.00", tags: "a" });
    card.vault_number = "4111222233334402";
    card.vault_pin = "9021";
    const pub = toPublicCard(card, TODAY);
    expect(pub).not.toHaveProperty("vault_number");
    expect(pub).not.toHaveProperty("vault_pin");
    expect(pub.has_vault).toBe(true);
    expect(pub.state).toBe("spent");
    expect(pub.tags).toEqual(["a"]);
  });
});
