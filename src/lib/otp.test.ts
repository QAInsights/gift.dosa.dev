import { beforeEach, describe, expect, it } from "vitest";
import { burnOtpIfLive } from "./db";
import { requestCode, sessionUser, signOut, verifyCode } from "./otp";
import { FakeDb, expectAuthError } from "./fake-db";

const NOW = 1_790_000_000_000;
let db: FakeDb;

beforeEach(() => {
  db = new FakeDb();
});

describe("requestCode", () => {
  it("stores only a salted hash, never the code", async () => {
    const { code, email, id } = await requestCode(db, "Ada@Example.com", NOW);
    expect(code).toMatch(/^\d{6}$/);
    expect(email).toBe("ada@example.com");
    expect(typeof id).toBe("string");
    expect(db.otps).toHaveLength(1);
    expect(db.otps[0].code_hash).toHaveLength(64);
    expect(db.otps[0].code_hash).not.toContain(code);
    expect(db.otps[0].expires_at).toBe(NOW + 10 * 60 * 1000);
  });

  it("rejects a resend within a minute, allows it after", async () => {
    await requestCode(db, "a@e.com", NOW);
    await expectAuthError(requestCode(db, "a@e.com", NOW + 59_000), 429);
    await requestCode(db, "a@e.com", NOW + 61_000);
    expect(db.otps).toHaveLength(2);
  });

  it("caps requests at five per hour", async () => {
    for (let i = 0; i < 5; i += 1) {
      await requestCode(db, "a@e.com", NOW + i * 61_000);
    }
    await expectAuthError(requestCode(db, "a@e.com", NOW + 5 * 61_000), 429);
  });
});

describe("verifyCode", () => {
  it("creates the user and a session on first verify", async () => {
    const { code } = await requestCode(db, "ada@e.com", NOW);
    const { user, newUser, token } = await verifyCode(db, "ada@e.com", code, "Ada", NOW);
    expect(newUser).toBe(true);
    expect(user.email).toBe("ada@e.com");
    expect(user.name).toBe("Ada");
    expect(token.length).toBeGreaterThan(20);
    expect(db.sessions).toHaveLength(1);
    expect(db.sessions[0].token_hash).not.toContain(token);
    await expect(sessionUser(db, token, NOW)).resolves.toMatchObject({ email: "ada@e.com" });
  });

  it("burns the code so it cannot be reused", async () => {
    const { code } = await requestCode(db, "ada@e.com", NOW);
    await verifyCode(db, "ada@e.com", code, null, NOW);
    await expectAuthError(verifyCode(db, "ada@e.com", code, null, NOW), 401);
  });

  it("keeps the first code valid until it expires", async () => {
    const first = await requestCode(db, "ada@e.com", NOW);
    const second = await requestCode(db, "ada@e.com", NOW + 61_000);
    const { user } = await verifyCode(db, "ada@e.com", first.code, null, NOW + 61_000);
    expect(user.email).toBe("ada@e.com");
    const retry = await verifyCode(db, "ada@e.com", second.code, null, NOW + 61_000);
    expect(retry.newUser).toBe(false);
  });

  it("burns atomically: the second burn reports no change", async () => {
    const { id } = await requestCode(db, "ada@e.com", NOW);
    await expect(burnOtpIfLive(db, id, NOW)).resolves.toBe(true);
    await expect(burnOtpIfLive(db, id, NOW)).resolves.toBe(false);
  });

  it("signs in an existing user without touching the name", async () => {
    const first = await requestCode(db, "ada@e.com", NOW);
    await verifyCode(db, "ada@e.com", first.code, "Ada", NOW);
    const second = await requestCode(db, "ada@e.com", NOW + 61_000);
    const { newUser, user } = await verifyCode(db, "ada@e.com", second.code, "Someone Else", NOW + 61_000);
    expect(newUser).toBe(false);
    expect(user.name).toBe("Ada");
    expect(db.users).toHaveLength(1);
  });

  it("counts wrong guesses, then burns the code", async () => {
    const { code } = await requestCode(db, "ada@e.com", NOW);
    const wrong = code === "000000" ? "000001" : "000000";
    for (let i = 0; i < 5; i += 1) {
      await expectAuthError(verifyCode(db, "ada@e.com", wrong, null, NOW), 401);
    }
    await expectAuthError(verifyCode(db, "ada@e.com", code, null, NOW), 429);
    await expectAuthError(verifyCode(db, "ada@e.com", code, null, NOW), 401);
  });

  it("rejects expired codes", async () => {
    const { code } = await requestCode(db, "ada@e.com", NOW);
    await expectAuthError(verifyCode(db, "ada@e.com", code, null, NOW + 10 * 60 * 1000 + 1), 401);
  });
});

describe("sessionUser and signOut", () => {
  it("returns null for unknown or expired sessions", async () => {
    await expect(sessionUser(db, null, NOW)).resolves.toBeNull();
    await expect(sessionUser(db, "nope", NOW)).resolves.toBeNull();
    const { code } = await requestCode(db, "ada@e.com", NOW);
    const { token } = await verifyCode(db, "ada@e.com", code, null, NOW);
    await expect(sessionUser(db, token, NOW + 31 * 24 * 60 * 60 * 1000)).resolves.toBeNull();
  });

  it("signOut drops the session", async () => {
    const { code } = await requestCode(db, "ada@e.com", NOW);
    const { token } = await verifyCode(db, "ada@e.com", code, null, NOW);
    await signOut(db, token);
    await expect(sessionUser(db, token, NOW)).resolves.toBeNull();
    await signOut(db, null);
  });
});
