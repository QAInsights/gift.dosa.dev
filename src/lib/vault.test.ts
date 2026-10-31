import { beforeEach, describe, expect, it } from "vitest";
import { createCard } from "./cards";
import { createDrawer } from "./drawers";
import { FakeDb, expectAuthError } from "./fake-db";
import { clearVault, normalizeVaultNumber, normalizeVaultPin, revealVault, setVault } from "./vault";

const NOW = 1_790_000_000_000;
const USER = "u1";
const PASS = "drawer-secret";
let db: FakeDb;

beforeEach(() => {
  db = new FakeDb();
});

async function sealedCard(): Promise<{ cardId: string; drawerId: string }> {
  const drawer = await createDrawer(db, USER, "Gifts", PASS, NOW);
  const card = await createCard(db, USER, { retailer: "Mart", balance: "12.00", drawer_id: drawer.id }, [drawer.id]);
  return { cardId: card.id, drawerId: drawer.id };
}

describe("validators", () => {
  it("accepts digit runs, rejects the rest", () => {
    expect(normalizeVaultNumber("4111 2222 3333 4402")).toBe("4111222233334402");
    expect(normalizeVaultPin("9021")).toBe("9021");
    expect(() => normalizeVaultNumber("123")).toThrow();
    expect(() => normalizeVaultNumber("abcd-5678")).toThrow();
    expect(() => normalizeVaultPin("12")).toThrow();
    expect(() => normalizeVaultPin("abcd")).toThrow();
  });
});

describe("setVault and revealVault", () => {
  it("stores and reveals behind a sealed, unlocked drawer", async () => {
    const { cardId, drawerId } = await sealedCard();
    await setVault(db, USER, cardId, [drawerId], { number: "4111 2222 3333 4402", pin: "9021" });
    const vault = await revealVault(db, USER, cardId, [drawerId]);
    expect(vault).toEqual({ number: "4111222233334402", pin: "9021" });
  });

  it("refuses open drawers and locked sessions", async () => {
    const open = await createDrawer(db, USER, "Food", null, NOW);
    const plain = await createCard(db, USER, { retailer: "Mart", balance: "1.00", drawer_id: open.id });
    await expectAuthError(setVault(db, USER, plain.id, [], { number: "41112222", pin: "9021" }), 403);
    const loose = await createCard(db, USER, { retailer: "Shop", balance: "1.00" });
    await expectAuthError(setVault(db, USER, loose.id, [], { number: "41112222", pin: "9021" }), 403);
    const { cardId } = await sealedCard();
    await expectAuthError(setVault(db, USER, cardId, [], { number: "41112222", pin: "9021" }), 403);
    await expectAuthError(revealVault(db, USER, cardId, []), 403);
  });

  it("reports a missing vault and missing cards", async () => {
    const { cardId, drawerId } = await sealedCard();
    await expectAuthError(revealVault(db, USER, cardId, [drawerId]), 404);
    await expectAuthError(revealVault(db, USER, "missing", []), 404);
    await expectAuthError(setVault(db, USER, "missing", [], { number: "41112222", pin: "9021" }), 404);
  });
});

describe("clearVault", () => {
  it("removes the vault and respects seals", async () => {
    const { cardId, drawerId } = await sealedCard();
    await setVault(db, USER, cardId, [drawerId], { number: "41112222", pin: "9021" });
    await expectAuthError(clearVault(db, USER, cardId, []), 403);
    await clearVault(db, USER, cardId, [drawerId]);
    await expectAuthError(revealVault(db, USER, cardId, [drawerId]), 404);
  });
});
