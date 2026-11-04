import { describe, expect, it } from "vitest";
import { randomToken } from "./auth";
import { DEMO_DRAWER_PASSWORD, readDemoConfig, seedDemoCabinet } from "./demo";
import { verifyLockPassword } from "./drawers";
import { FakeDb } from "./fake-db";

const USER = "user-demo";
const NOW = 1_790_000_000_000;
const KEY = randomToken(32);

function freshDb(): FakeDb {
  const db = new FakeDb();
  db.users.push({ id: USER, email: "demo@gift.dosa.dev", name: null, created_at: NOW, updated_at: NOW });
  return db;
}

describe("seedDemoCabinet", () => {
  it("seeds 12 cards, 5 drawers (one locked), 3 todos (one done)", async () => {
    const db = freshDb();
    const { sealedDrawerId } = await seedDemoCabinet(db, USER, NOW, KEY);
    expect(db.cards).toHaveLength(12);
    expect(db.drawers).toHaveLength(5);
    expect(db.drawers.filter((d) => d.lock_hash)).toHaveLength(1);
    expect(sealedDrawerId).toBe(db.drawers.find((d) => d.lock_hash)?.id);
    expect(db.todos).toHaveLength(3);
    expect(db.todos.filter((t) => t.done === 1)).toHaveLength(1);
  });

  it("records a Starbucks redemption and a memory card at zero", async () => {
    const db = freshDb();
    await seedDemoCabinet(db, USER, NOW, KEY);
    const starbucks = db.cards.find((c) => c.retailer === "Starbucks");
    expect(starbucks?.balance_cents).toBe(735);
    const redemption = db.redemptions.find((r) => r.card_id === starbucks?.id);
    expect(redemption?.before_cents).toBe(1200);
    expect(redemption?.after_cents).toBe(735);
    expect(redemption?.undone_at).toBeNull();
    const coffee = db.cards.find((c) => c.retailer === "Local Coffee Roasters");
    expect(coffee?.balance_cents).toBe(0);
    expect(coffee?.is_memory).toBe(1);
  });

  it("vaults the Amazon card and sets reminders on the right cards", async () => {
    const db = freshDb();
    await seedDemoCabinet(db, USER, NOW, KEY);
    const amazon = db.cards.find((c) => c.retailer === "Amazon");
    expect(amazon?.vault_number).toBeTruthy();
    expect(amazon?.vault_pin).toBeTruthy();
    const reminded = new Set(db.reminders.map((r) => r.card_id));
    for (const retailer of ["Target", "Shell", "Bookshop", "Steam", "Airbnb", "Walmart"]) {
      const card = db.cards.find((c) => c.retailer === retailer);
      expect(card && reminded.has(card.id)).toBe(true);
    }
    expect(db.reminders).toHaveLength(6);
  });

  it("is idempotent — a second seed resets first", async () => {
    const db = freshDb();
    await seedDemoCabinet(db, USER, NOW, KEY);
    const second = await seedDemoCabinet(db, USER, NOW, KEY);
    expect(db.cards).toHaveLength(12);
    expect(db.drawers).toHaveLength(5);
    expect(db.todos).toHaveLength(3);
    expect(db.redemptions).toHaveLength(2);
    expect(second.sealedDrawerId).toBeTruthy();
  });

  it("seals the Family drawer with a custom drawer password", async () => {
    const db = freshDb();
    await seedDemoCabinet(db, USER, NOW, KEY, "secret-sauce");
    const family = db.drawers.find((d) => d.lock_hash);
    expect(family).toBeTruthy();
    await expect(verifyLockPassword("secret-sauce", family!.lock_hash!)).resolves.toBe(true);
    await expect(verifyLockPassword(DEMO_DRAWER_PASSWORD, family!.lock_hash!)).resolves.toBe(false);
  });

  it("readDemoConfig picks up non-empty env values", () => {
    expect(readDemoConfig({ DEMO_SECRET: "s", DEMO_DRAWER_PASSWORD: "p" })).toEqual({ secret: "s", drawerPassword: "p", email: "demo@gift.dosa.dev" });
    expect(readDemoConfig({ DEMO_SECRET: "  " })).toEqual({ secret: null, drawerPassword: null, email: "demo@gift.dosa.dev" });
    expect(readDemoConfig(null)).toEqual({ secret: null, drawerPassword: null, email: "demo@gift.dosa.dev" });
  });

  it("readDemoConfig honours a DEMO_EMAIL override and falls back on bad input", () => {
    expect(readDemoConfig({ DEMO_EMAIL: " Someone@Example.com " }).email).toBe("someone@example.com");
    expect(readDemoConfig({ DEMO_EMAIL: "not-an-email" }).email).toBe("demo@gift.dosa.dev");
    expect(readDemoConfig({}).email).toBe("demo@gift.dosa.dev");
  });

  it("password constant matches what the drawer was seeded with", () => {
    expect(DEMO_DRAWER_PASSWORD).toBe("cabinet-demo");
  });
});
