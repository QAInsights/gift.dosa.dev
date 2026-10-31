import { describe, expect, it } from "vitest";
import { clearSamples, createCard, dashboard, listCabinet, todayYmd } from "./cards";
import { FakeDb } from "./fake-db";
import { seedStarterCabinet, STARTER_DRAWERS } from "./seed";

const USER = "user-seed";
const today = todayYmd();

async function seeded(): Promise<FakeDb> {
  const db = new FakeDb();
  await seedStarterCabinet(db, USER);
  return db;
}

describe("seedStarterCabinet", () => {
  it("files the four starter drawers", async () => {
    const db = await seeded();
    expect(db.drawers.map((d) => d.name).sort()).toEqual([...STARTER_DRAWERS].sort());
    expect(db.drawers.every((d) => d.user_id === USER && d.lock_hash === null)).toBe(true);
  });

  it("prefills realistic sample cards across the drawers", async () => {
    const db = await seeded();
    expect(db.cards).toHaveLength(6);
    expect(db.cards.every((c) => c.sample === 1)).toBe(true);
    const retailers = db.cards.map((c) => c.retailer).sort();
    expect(retailers).toEqual(["Airbnb", "Bookshop", "Shell", "Starbucks", "Steam", "Whole Foods"]);
    const { cards } = await listCabinet(db, USER, [], {}, today);
    const states = cards.map((c) => c.state).sort();
    expect(states).toContain("filed");
    expect(states).toContain("due");
    expect(states).toContain("spent");
    expect(cards.every((c) => c.sample)).toBe(true);
  });

  it("shows samples in the dashboard until cleared", async () => {
    const db = await seeded();
    const before = await dashboard(db, USER, [], today);
    expect(before.sampleCount).toBe(6);
    expect(before.dueCount).toBe(1);
    expect(before.expiring.map((c) => c.retailer)).toEqual(["Steam"]);
  });
});

describe("clearSamples", () => {
  it("removes only sample cards and keeps real ones", async () => {
    const db = await seeded();
    await createCard(db, USER, { retailer: "Mart", balance: "12.50" });
    const removed = await clearSamples(db, USER);
    expect(removed).toBe(6);
    expect(db.cards.map((c) => c.retailer)).toEqual(["Mart"]);
    const after = await dashboard(db, USER, [], today);
    expect(after.sampleCount).toBe(0);
    expect(after.cardCount).toBe(1);
  });

  it("returns zero when there is nothing to clear", async () => {
    const db = new FakeDb();
    await expect(clearSamples(db, USER)).resolves.toBe(0);
  });
});
