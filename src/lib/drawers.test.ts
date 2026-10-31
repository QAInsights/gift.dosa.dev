import { beforeEach, describe, expect, it } from "vitest";
import { AuthError } from "./auth";
import { createCard } from "./cards";
import {
  createDrawer,
  drawersWithCounts,
  hashLockPassword,
  isUnlocked,
  normalizeDrawerEmoji,
  relockDrawer,
  removeDrawer,
  removeLock,
  renameDrawer,
  setDrawerEmoji,
  setLock,
  toPublicDrawer,
  unlockDrawer,
  verifyLockPassword,
} from "./drawers";
import { FakeDb, expectAuthError } from "./fake-db";

const NOW = 1_790_000_000_000;
const USER = "u1";
const PASS = "drawer-secret";
let db: FakeDb;

beforeEach(() => {
  db = new FakeDb();
});

describe("drawer passwords", () => {
  it("hashes and verifies with PBKDF2", async () => {
    const hash = await hashLockPassword("s3cret-drawer");
    expect(hash.startsWith("pbkdf2$100000$")).toBe(true);
    expect(hash).not.toContain("s3cret");
    await expect(verifyLockPassword("s3cret-drawer", hash)).resolves.toBe(true);
    await expect(verifyLockPassword("wrong one", hash)).resolves.toBe(false);
  });

  it("rejects malformed hashes and short passwords", async () => {
    await expect(verifyLockPassword("x", "not-a-hash")).resolves.toBe(false);
    await expect(verifyLockPassword("x", "pbkdf2$abc$salt$hash")).resolves.toBe(false);
    await expectAuthError(createDrawer(db, USER, "Food", "short", NOW), 400);
  });
});

describe("createDrawer", () => {
  it("trims names and stores an optional lock", async () => {
    const open = await createDrawer(db, USER, "  Food  ", null, NOW);
    expect(open.name).toBe("Food");
    expect(open.lock_hash).toBeNull();
    const sealed = await createDrawer(db, USER, "Gifts", PASS, NOW);
    expect(sealed.lock_hash?.startsWith("pbkdf2$")).toBe(true);
  });

  it("rejects blank names and duplicates with 409", async () => {
    await createDrawer(db, USER, "Food", null, NOW);
    await expectAuthError(createDrawer(db, USER, "Food", null, NOW), 409);
    await expectAuthError(createDrawer(db, USER, "food", null, NOW), 409);
    await expectAuthError(createDrawer(db, USER, "  ", null, NOW), 400);
    await expectAuthError(createDrawer(db, USER, "x".repeat(61), null, NOW), 400);
  });

  it("reserves Personal for the loose-cards pile", async () => {
    await expectAuthError(createDrawer(db, USER, "Personal", null, NOW), 400);
    await expectAuthError(createDrawer(db, USER, "  personal  ", null, NOW), 400);
  });
});

describe("renameDrawer", () => {
  it("renames and guards clashes", async () => {
    const food = await createDrawer(db, USER, "Food", null, NOW);
    await createDrawer(db, USER, "Books", null, NOW);
    const renamed = await renameDrawer(db, USER, food.id, "Groceries", NOW);
    expect(renamed.name).toBe("Groceries");
    await expectAuthError(renameDrawer(db, USER, food.id, "Books", NOW), 409);
    await expectAuthError(renameDrawer(db, USER, food.id, "books", NOW), 409);
    await expectAuthError(renameDrawer(db, USER, "missing", "X", NOW), 404);
  });
});

describe("setLock and removeLock", () => {
  it("seals an open drawer without a current password", async () => {
    const drawer = await createDrawer(db, USER, "Food", null, NOW);
    const sealed = await setLock(db, USER, drawer.id, "new-pass", null, NOW);
    expect(sealed.lock_hash?.startsWith("pbkdf2$")).toBe(true);
  });

  it("changing a lock needs the current password", async () => {
    const drawer = await createDrawer(db, USER, "Food", "old-pass", NOW);
    await expectAuthError(setLock(db, USER, drawer.id, "new-pass", "wrong one", NOW), 401);
    const changed = await setLock(db, USER, drawer.id, "new-pass", "old-pass", NOW);
    await expect(verifyLockPassword("new-pass", changed.lock_hash as string)).resolves.toBe(true);
  });

  it("removing a lock needs the password", async () => {
    const drawer = await createDrawer(db, USER, "Food", "old-pass", NOW);
    await expectAuthError(removeLock(db, USER, drawer.id, "wrong one", NOW), 401);
    const open = await removeLock(db, USER, drawer.id, "old-pass", NOW);
    expect(open.lock_hash).toBeNull();
    await expectAuthError(removeLock(db, USER, drawer.id, "old-pass", NOW), 400);
  });
});

describe("unlockDrawer and relockDrawer", () => {
  it("adds the drawer id once and relocks cleanly", async () => {
    const drawer = await createDrawer(db, USER, "Food", PASS, NOW);
    const once = await unlockDrawer(db, USER, drawer.id, PASS, []);
    expect(once).toEqual([drawer.id]);
    const twice = await unlockDrawer(db, USER, drawer.id, PASS, once);
    expect(twice).toEqual([drawer.id]);
    expect(relockDrawer(drawer.id, twice)).toEqual([]);
    expect(isUnlocked(drawer, [])).toBe(false);
    expect(isUnlocked(drawer, [drawer.id])).toBe(true);
  });

  it("rejects wrong passwords and lock-free drawers", async () => {
    const sealed = await createDrawer(db, USER, "Food", PASS, NOW);
    const open = await createDrawer(db, USER, "Books", null, NOW);
    await expectAuthError(unlockDrawer(db, USER, sealed.id, "wrong one", []), 401);
    await expectAuthError(unlockDrawer(db, USER, open.id, "anything", []), 400);
    expect(isUnlocked(open, [])).toBe(true);
  });

  it("locks out after five wrong guesses, then recovers", async () => {
    const drawer = await createDrawer(db, USER, "Food", PASS, NOW);
    for (let i = 0; i < 5; i += 1) {
      await expectAuthError(unlockDrawer(db, USER, drawer.id, "wrong one", [], NOW), 401);
    }
    await expectAuthError(unlockDrawer(db, USER, drawer.id, PASS, [], NOW), 429);
    const next = await unlockDrawer(db, USER, drawer.id, PASS, [], NOW + 16 * 60 * 1000);
    expect(next).toEqual([drawer.id]);
  });
});

describe("removeDrawer", () => {
  it("unfiles cards instead of deleting them", async () => {
    const drawer = await createDrawer(db, USER, "Food", null, NOW);
    await createCard(db, USER, { retailer: "Mart", balance: "12.00", drawer_id: drawer.id });
    await removeDrawer(db, USER, drawer.id, []);
    expect(db.drawers).toHaveLength(0);
    expect(db.cards).toHaveLength(1);
    expect(db.cards[0].drawer_id).toBeNull();
  });

  it("needs the drawer unlocked first", async () => {
    const drawer = await createDrawer(db, USER, "Food", PASS, NOW);
    await expectAuthError(removeDrawer(db, USER, drawer.id, []), 403);
    await removeDrawer(db, USER, drawer.id, [drawer.id]);
    expect(db.drawers).toHaveLength(0);
  });
});

describe("drawersWithCounts", () => {
  it("counts cards and subtotals open drawers only", async () => {
    const food = await createDrawer(db, USER, "Food", null, NOW);
    const gifts = await createDrawer(db, USER, "Gifts", PASS, NOW);
    await createCard(db, USER, { retailer: "Mart", balance: "5.00", drawer_id: food.id });
    await createCard(db, USER, { retailer: "Cafe", balance: "7.00", currency: "EUR", drawer_id: food.id });
    await createCard(db, USER, { retailer: "Secret", balance: "99.00", drawer_id: gifts.id }, [gifts.id]);
    const sealed = await drawersWithCounts(db, USER, []);
    expect(sealed.find((d) => d.id === food.id)?.cardCount).toBe(2);
    expect(sealed.find((d) => d.id === food.id)?.subtotals).toEqual({ USD: 500, EUR: 700 });
    expect(sealed.find((d) => d.id === gifts.id)?.cardCount).toBe(1);
    expect(sealed.find((d) => d.id === gifts.id)?.subtotals).toEqual({});
    const open = await drawersWithCounts(db, USER, [gifts.id]);
    expect(open.find((d) => d.id === gifts.id)?.subtotals).toEqual({ USD: 9900 });
  });

  it("throws AuthError, not a raw error, on clashes", async () => {
    await createDrawer(db, USER, "Food", null, NOW);
    try {
      await createDrawer(db, USER, "Food", null, NOW);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(AuthError);
    }
  });
});

describe("drawer emoji", () => {
  it("defaults to a gift and accepts only the curated picker set", async () => {
    const drawer = await createDrawer(db, USER, "Birthdays", null, NOW);
    expect(drawer.emoji).toBe("🎁");
    expect(normalizeDrawerEmoji(" 🎂 ")).toBe("🎂");
    await expectAuthError((async () => normalizeDrawerEmoji("🚀"))(), 400);
    await expect(setDrawerEmoji(db, USER, drawer.id, "🎄", NOW)).resolves.toBe("🎄");
    expect(toPublicDrawer({ ...drawer, emoji: "🎄" }, [], 0, {}).emoji).toBe("🎄");
  });

  it("allows emoji changes on sealed drawers without unlocking", async () => {
    const sealed = await createDrawer(db, USER, "Gifts", PASS, NOW);
    await expect(setDrawerEmoji(db, USER, sealed.id, "🎂", NOW)).resolves.toBe("🎂");
  });
});

describe("renameDrawer seal gate", () => {
  it("refuses to rename a sealed drawer until it is unlocked", async () => {
    const drawer = await createDrawer(db, USER, "Gifts", PASS, NOW);
    await expectAuthError(renameDrawer(db, USER, drawer.id, "Presents", NOW), 403);
    const renamed = await renameDrawer(db, USER, drawer.id, "Presents", NOW, [drawer.id]);
    expect(renamed.name).toBe("Presents");
  });
});
