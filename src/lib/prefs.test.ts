import { describe, expect, it } from "vitest";
import { createCard } from "./cards";
import { formatDate } from "./format";
import { FakeDb, expectAuthError } from "./fake-db";
import { DEFAULT_PREFS, getPrefs, normalizePrefs, updateProfile } from "./prefs";

const USER = "u-prefs";
const NOW = 1_790_000_000_000;

function seedUser(db: FakeDb): void {
  db.users.push({ id: USER, email: "ada@test.dev", name: null, created_at: NOW, updated_at: NOW });
}

describe("normalizePrefs", () => {
  it("applies defaults and normalizes case", () => {
    expect(normalizePrefs({})).toEqual(DEFAULT_PREFS);
    expect(normalizePrefs({ region: "uk", currency: "gbp", date_format: "dmy" })).toEqual({
      region: "UK",
      currency: "GBP",
      dateFormat: "DMY",
    });
  });

  it("rejects unknown regions, currencies, and date formats", async () => {
    await expectAuthError((async () => normalizePrefs({ region: "FR" }))(), 400);
    await expectAuthError((async () => normalizePrefs({ currency: "US" }))(), 400);
    await expectAuthError((async () => normalizePrefs({ date_format: "YMD" }))(), 400);
  });
});

describe("profile round-trip", () => {
  it("returns defaults before anything is saved", async () => {
    const db = new FakeDb();
    seedUser(db);
    await expect(getPrefs(db, USER)).resolves.toEqual(DEFAULT_PREFS);
  });

  it("saves the display name and preferences, then reads them back per user", async () => {
    const db = new FakeDb();
    seedUser(db);
    const saved = await updateProfile(db, USER, { name: "  Ada  Lovelace ", region: "IN", currency: "INR", date_format: "ISO" }, NOW);
    expect(saved.name).toBe("Ada Lovelace");
    expect(saved.prefs).toEqual({ region: "IN", currency: "INR", dateFormat: "ISO" });
    await expect(getPrefs(db, USER)).resolves.toEqual({ region: "IN", currency: "INR", dateFormat: "ISO" });
    expect(db.users[0].name).toBe("Ada Lovelace");
    await expect(getPrefs(db, "someone-else")).resolves.toEqual(DEFAULT_PREFS);
  });

  it("updates in place and can clear the display name", async () => {
    const db = new FakeDb();
    seedUser(db);
    await updateProfile(db, USER, { name: "Ada", currency: "EUR" }, NOW);
    const again = await updateProfile(db, USER, { name: "", currency: "USD" }, NOW);
    expect(again.name).toBeNull();
    expect(again.prefs.currency).toBe("USD");
    expect(again.prefs.region).toBe("US");
    expect(db.prefs).toHaveLength(1);
  });

  it("rejects oversized names and bad values without writing", async () => {
    const db = new FakeDb();
    seedUser(db);
    await expectAuthError(updateProfile(db, USER, { name: "x".repeat(81) }, NOW), 400);
    await expectAuthError(updateProfile(db, USER, { region: "XX" }, NOW), 400);
    expect(db.prefs).toHaveLength(0);
    expect(db.users[0].name).toBeNull();
  });
});

describe("currency allowlist and legacy rows", () => {
  it("rejects well-formed but unlisted currencies on write", async () => {
    await expectAuthError((async () => normalizePrefs({ currency: "XYZ" }))(), 400);
    await expectAuthError((async () => normalizePrefs({ currency: "CAD" }))(), 400);
  });

  it("reads legacy rows leniently and lets the user repair them", async () => {
    const db = new FakeDb();
    seedUser(db);
    db.prefs.push({ user_id: USER, region: "FR", currency: "CAD", date_format: "YMD", updated_at: NOW });
    await expect(getPrefs(db, USER)).resolves.toEqual(DEFAULT_PREFS);
    const saved = await updateProfile(db, USER, { region: "UK" }, NOW);
    expect(saved.prefs.region).toBe("UK");
    expect(saved.prefs.currency).toBe("USD");
  });

  it("accepts a camelCase dateFormat from API clients", async () => {
    const db = new FakeDb();
    seedUser(db);
    const saved = await updateProfile(db, USER, { dateFormat: "DMY" }, NOW);
    expect(saved.prefs.dateFormat).toBe("DMY");
  });
});

describe("formatDate with a preference", () => {
  it("renders MDY by default, DMY, and ISO", () => {
    expect(formatDate("2027-05-03")).toBe("May 3, 2027");
    expect(formatDate("2027-05-03", "MDY")).toBe("May 3, 2027");
    expect(formatDate("2027-05-03", "DMY")).toBe("3 May 2027");
    expect(formatDate("2027-05-03", "ISO")).toBe("2027-05-03");
  });
});

describe("currency preference meets filing", () => {
  it("a card filed in the preferred currency keeps it", async () => {
    const db = new FakeDb();
    seedUser(db);
    const { prefs } = await updateProfile(db, USER, { currency: "GBP" }, NOW);
    const card = await createCard(db, USER, { retailer: "Tesco", balance: "9.50", currency: prefs.currency });
    expect(card.currency).toBe("GBP");
  });
});
