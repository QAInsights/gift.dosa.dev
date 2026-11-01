import { describe, expect, it } from "vitest";
import { randomToken } from "./auth";
import { decryptField, encryptField, isEncrypted, readVaultKey } from "./crypto";
import { expectAuthError } from "./fake-db";

const KEY = randomToken(32);
const OTHER_KEY = randomToken(32);

describe("vault field encryption", () => {
  it("round-trips a card number and PIN", async () => {
    const number = await encryptField(KEY, "u1", "vault:c1:number", "4111222233334402");
    const pin = await encryptField(KEY, "u1", "vault:c1:pin", "9021");
    expect(isEncrypted(number)).toBe(true);
    expect(number).not.toContain("4111222233334402");
    expect(await decryptField(KEY, "u1", "vault:c1:number", number)).toBe("4111222233334402");
    expect(await decryptField(KEY, "u1", "vault:c1:pin", pin)).toBe("9021");
  });

  it("uses a fresh IV for every seal", async () => {
    const first = await encryptField(KEY, "u1", "aad", "9021");
    const second = await encryptField(KEY, "u1", "aad", "9021");
    expect(first).not.toBe(second);
  });

  it("refuses the wrong user, wrong card, and wrong key", async () => {
    const stored = await encryptField(KEY, "u1", "vault:c1:number", "41112222");
    await expectAuthError(decryptField(KEY, "u2", "vault:c1:number", stored), 500);
    await expectAuthError(decryptField(KEY, "u1", "vault:c2:number", stored), 500);
    await expectAuthError(decryptField(OTHER_KEY, "u1", "vault:c1:number", stored), 500);
  });

  it("refuses tampered ciphertext", async () => {
    const stored = await encryptField(KEY, "u1", "aad", "41112222");
    const tampered = stored.slice(0, -2) + (stored.endsWith("AA") ? "BB" : "AA");
    await expectAuthError(decryptField(KEY, "u1", "aad", tampered), 500);
    await expectAuthError(decryptField(KEY, "u1", "aad", "v1.broken"), 500);
  });

  it("passes legacy plaintext through untouched", async () => {
    expect(isEncrypted("41112222")).toBe(false);
    expect(isEncrypted(null)).toBe(false);
    expect(await decryptField(KEY, "u1", "aad", "41112222")).toBe("41112222");
    expect(await decryptField(null, "u1", "aad", "41112222")).toBe("41112222");
  });

  it("needs a configured 32-byte key for new seals", async () => {
    await expectAuthError(encryptField(null, "u1", "aad", "9021"), 503);
    await expectAuthError(encryptField("too-short", "u1", "aad", "9021"), 500);
  });

  it("reads the key from worker env", () => {
    expect(readVaultKey({ VAULT_KEY: KEY })).toBe(KEY);
    expect(readVaultKey({})).toBeNull();
    expect(readVaultKey(null)).toBeNull();
    expect(readVaultKey({ VAULT_KEY: 42 })).toBeNull();
  });
});
