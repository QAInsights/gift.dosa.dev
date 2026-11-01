import { beforeEach, describe, expect, it } from "vitest";
import { createCard, updateCard } from "./cards";
import { createDrawer } from "./drawers";
import { FakeDb, expectAuthError } from "./fake-db";
import { canUndo, recordRedemption, undoRedemption, UNDO_WINDOW_MS } from "./redemptions";

const NOW = 1_790_000_000_000;
const USER = "u1";
const PASS = "drawer-secret";
let db: FakeDb;

beforeEach(() => {
  db = new FakeDb();
});

function freshCard(balance = "50.00") {
  return createCard(db, USER, { retailer: "Shop", balance, currency: "USD" }, [], NOW);
}

describe("recordRedemption", () => {
  it("spends an amount and stores before and after", async () => {
    const card = await freshCard();
    const { card: next, redemption } = await recordRedemption(db, USER, card.id, [], {
      mode: "spent",
      amount: "10",
    });
    expect(next.balance_cents).toBe(4000);
    expect(redemption.before_cents).toBe(5000);
    expect(redemption.after_cents).toBe(4000);
    expect(redemption.kind).toBe("manual");
    expect(db.cards[0]?.balance_cents).toBe(4000);
    expect(db.redemptions).toHaveLength(1);
  });

  it("sets the balance outright with remaining", async () => {
    const card = await freshCard();
    const { card: next } = await recordRedemption(db, USER, card.id, [], {
      mode: "remaining",
      amount: "20",
    });
    expect(next.balance_cents).toBe(2000);
  });

  it("rejects a spend beyond the balance", async () => {
    const card = await freshCard();
    await expectAuthError(recordRedemption(db, USER, card.id, [], { mode: "spent", amount: "60" }), 400);
  });

  it("rejects a zero spend", async () => {
    const card = await freshCard();
    await expectAuthError(recordRedemption(db, USER, card.id, [], { mode: "spent", amount: "0" }), 400);
  });

  it("rejects remaining equal to the current balance", async () => {
    const card = await freshCard();
    await expectAuthError(recordRedemption(db, USER, card.id, [], { mode: "remaining", amount: "50" }), 400);
  });

  it("rejects an unknown mode", async () => {
    const card = await freshCard();
    await expectAuthError(recordRedemption(db, USER, card.id, [], { mode: "gifted", amount: "10" }), 400);
  });

  it("blocks updates on sealed cards", async () => {
    const drawer = await createDrawer(db, USER, "Gifts", PASS, NOW);
    const card = await createCard(db, USER, { retailer: "Shop", balance: "50", drawer_id: drawer.id }, [drawer.id], NOW);
    await expectAuthError(recordRedemption(db, USER, card.id, [], { mode: "spent", amount: "10" }), 403);
  });
});

describe("undoRedemption", () => {
  it("restores the balance and marks the row undone", async () => {
    const card = await freshCard();
    const { redemption } = await recordRedemption(db, USER, card.id, [], { mode: "spent", amount: "10" });
    const restored = await undoRedemption(db, USER, card.id, redemption.id, []);
    expect(restored.balance_cents).toBe(5000);
    expect(db.redemptions[0]?.undone_at).not.toBeNull();
    expect(db.cards[0]?.balance_cents).toBe(5000);
  });

  it("rejects a second undo", async () => {
    const card = await freshCard();
    const { redemption } = await recordRedemption(db, USER, card.id, [], { mode: "spent", amount: "10" });
    await undoRedemption(db, USER, card.id, redemption.id, []);
    await expectAuthError(undoRedemption(db, USER, card.id, redemption.id, []), 409);
  });

  it("rejects undo once a later redemption exists", async () => {
    const card = await freshCard();
    const first = await recordRedemption(db, USER, card.id, [], { mode: "spent", amount: "10" });
    await recordRedemption(db, USER, card.id, [], { mode: "spent", amount: "5" });
    await expectAuthError(undoRedemption(db, USER, card.id, first.redemption.id, []), 409);
  });

  it("rejects undo after the balance was edited another way", async () => {
    const card = await freshCard();
    const { redemption } = await recordRedemption(db, USER, card.id, [], { mode: "spent", amount: "10" });
    await updateCard(db, USER, card.id, [], { balance: "30" });
    await expectAuthError(undoRedemption(db, USER, card.id, redemption.id, []), 409);
  });

  it("reports a missing redemption as not on file", async () => {
    const card = await freshCard();
    await expectAuthError(undoRedemption(db, USER, card.id, "nope", []), 404);
  });
});

describe("updateCard write-through", () => {
  it("records a kind 'edit' redemption when the balance changes", async () => {
    const card = await freshCard();
    await updateCard(db, USER, card.id, [], { balance: "30" });
    expect(db.redemptions).toHaveLength(1);
    expect(db.redemptions[0]?.kind).toBe("edit");
    expect(db.redemptions[0]?.before_cents).toBe(5000);
    expect(db.redemptions[0]?.after_cents).toBe(3000);
  });

  it("records nothing when the balance stays the same", async () => {
    const card = await freshCard();
    await updateCard(db, USER, card.id, [], { nickname: "For Maya" });
    expect(db.redemptions).toHaveLength(0);
    await updateCard(db, USER, card.id, [], { balance: "50" });
    expect(db.redemptions).toHaveLength(0);
  });
});

describe("canUndo", () => {
  it("allows undo inside the window and not after", async () => {
    const card = await freshCard();
    const { redemption } = await recordRedemption(db, USER, card.id, [], { mode: "spent", amount: "10" }, NOW);
    expect(canUndo(redemption, NOW + 1000)).toBe(true);
    expect(canUndo(redemption, NOW + UNDO_WINDOW_MS + 1)).toBe(false);
  });

  it("disallows undo on an undone row", async () => {
    const card = await freshCard();
    const { redemption } = await recordRedemption(db, USER, card.id, [], { mode: "spent", amount: "10" }, NOW);
    await undoRedemption(db, USER, card.id, redemption.id, []);
    expect(canUndo(db.redemptions[0]!, NOW + 1000)).toBe(false);
  });
});
