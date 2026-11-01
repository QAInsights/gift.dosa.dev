import { beforeEach, describe, expect, it } from "vitest";
import { randomToken } from "./auth";
import { createCard } from "./cards";
import { isEncrypted } from "./crypto";
import { createDrawer } from "./drawers";
import { findCard, updateCardVault } from "./db";
import { FakeDb, expectAuthError } from "./fake-db";
import { clearVault, normalizeVaultNumber, normalizeVaultPin, revealVault, setVault } from "./vault";

const NOW = 1_790_000_000_000;
const USER = "u1";
const PASS = "drawer-secret";
const KEY = randomToken(32);
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
    await setVault(db, USER, cardId, [drawerId], { number: "4111 2222 3333 4402", pin: "9021" }, KEY);
    const vault = await revealVault(db, USER, cardId, [drawerId], KEY);
    expect(vault).toEqual({ number: "4111222233334402", pin: "9021" });
  });

  it("refuses open drawers and locked sessions", async () => {
    const open = await createDrawer(db, USER, "Food", null, NOW);
    const plain = await createCard(db, USER, { retailer: "Mart", balance: "1.00", drawer_id: open.id });
    await expectAuthError(setVault(db, USER, plain.id, [], { number: "41112222", pin: "9021" }, KEY), 403);
    const loose = await createCard(db, USER, { retailer: "Shop", balance: "1.00" });
    await expectAuthError(setVault(db, USER, loose.id, [], { number: "41112222", pin: "9021" }, KEY), 403);
    const { cardId } = await sealedCard();
    await expectAuthError(setVault(db, USER, cardId, [], { number: "41112222", pin: "9021" }, KEY), 403);
    await expectAuthError(revealVault(db, USER, cardId, [], KEY), 403);
  });

  it("reports a missing vault and missing cards", async () => {
    const { cardId, drawerId } = await sealedCard();
    await expectAuthError(revealVault(db, USER, cardId, [drawerId], KEY), 404);
    await expectAuthError(revealVault(db, USER, "missing", [], KEY), 404);
    await expectAuthError(setVault(db, USER, "missing", [], { number: "41112222", pin: "9021" }, KEY), 404);
  });

  it("stores ciphertext at rest, never the card number", async () => {
    const { cardId, drawerId } = await sealedCard();
    await setVault(db, USER, cardId, [drawerId], { number: "4111222233334402", pin: "9021" }, KEY);
    const row = await findCard(db, cardId, USER);
    expect(row?.vault_number).toContain("v1.");
    expect(row?.vault_pin).toContain("v1.");
    expect(isEncrypted(row?.vault_number)).toBe(true);
    expect(row?.vault_number).not.toContain("4111222233334402");
    expect(row?.vault_pin).not.toContain("9021");
  });

  it("still opens legacy plaintext vaults", async () => {
    const { cardId, drawerId } = await sealedCard();
    await updateCardVault(db, cardId, USER, "41112222", "9021", NOW);
    const vault = await revealVault(db, USER, cardId, [drawerId], KEY);
    expect(vault).toEqual({ number: "41112222", pin: "9021" });
  });

  it("refuses to seal when encryption is not configured", async () => {
    const { cardId, drawerId } = await sealedCard();
    await expectAuthError(
      setVault(db, USER, cardId, [drawerId], { number: "41112222", pin: "9021" }, null),
      503,
    );
  });
});

describe("clearVault", () => {
  it("removes the vault and respects seals", async () => {
    const { cardId, drawerId } = await sealedCard();
    await setVault(db, USER, cardId, [drawerId], { number: "41112222", pin: "9021" }, KEY);
    await expectAuthError(clearVault(db, USER, cardId, []), 403);
    await clearVault(db, USER, cardId, [drawerId]);
    await expectAuthError(revealVault(db, USER, cardId, [drawerId], KEY), 404);
  });
});
