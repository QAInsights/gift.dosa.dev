import { describe, expect, it } from "vitest";
import {
  AuthError,
  clearSessionCookie,
  generateCode,
  normalizeCode,
  normalizeEmail,
  normalizeName,
  randomToken,
  readSessionCookie,
  secretsEqual,
  sessionCookie,
  sha256Hex,
} from "./auth";

describe("normalizeEmail", () => {
  it("lowercases and trims", () => {
    expect(normalizeEmail("  Ada@Example.COM ")).toBe("ada@example.com");
  });

  it.each([[""], ["not-an-email"], ["a@b"], ["a b@c.com"], ["x".repeat(250) + "@e.com"], [null], [42]])(
    "rejects %s with 400",
    (raw) => {
      try {
        normalizeEmail(raw);
        expect.unreachable();
      } catch (error) {
        expect(error).toBeInstanceOf(AuthError);
        expect((error as AuthError).status).toBe(400);
      }
    },
  );
});

describe("normalizeName", () => {
  it("passes through a trimmed name", () => {
    expect(normalizeName("  Ada  ")).toBe("Ada");
  });

  it.each([[undefined], [null], [""], ["   "]])("treats %s as no name", (raw) => {
    expect(normalizeName(raw)).toBeNull();
  });

  it.each([[42], ["x".repeat(81)]])("rejects %s", (raw) => {
    expect(() => normalizeName(raw)).toThrow(AuthError);
  });
});

describe("normalizeCode", () => {
  it("passes through a 6-digit code", () => {
    expect(normalizeCode("042135")).toBe("042135");
  });

  it.each([["12345"], ["1234567"], ["abcdef"], [""], [null], [123456]])("rejects %s", (raw) => {
    expect(() => normalizeCode(raw)).toThrow(AuthError);
  });
});

describe("generateCode", () => {
  it("returns 6 digits with variety", () => {
    const codes = new Set(Array.from({ length: 200 }, generateCode));
    expect(codes.size).toBeGreaterThan(190);
    for (const code of codes) expect(code).toMatch(/^\d{6}$/);
  });
});

describe("randomToken", () => {
  it("returns url-safe base64 without padding", () => {
    const token = randomToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomToken()).not.toBe(token);
  });
});

describe("sha256Hex", () => {
  it("matches the known vector", async () => {
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("secretsEqual", () => {
  it("compares by value", async () => {
    expect(await secretsEqual("same", "same")).toBe(true);
    expect(await secretsEqual("one", "two")).toBe(false);
    expect(await secretsEqual("short", "a much longer value")).toBe(false);
  });
});

describe("session cookie", () => {
  it("round-trips through the header", () => {
    const header = sessionCookie("tok123", true);
    expect(header).toContain("Secure");
    expect(header).toContain("HttpOnly");
    expect(readSessionCookie(`other=1; ${header.split(";")[0]}; x=y`)).toBe("tok123");
  });

  it("omits Secure over http and clears cleanly", () => {
    expect(sessionCookie("t", false)).not.toContain("Secure");
    expect(readSessionCookie(clearSessionCookie())).toBeNull();
    expect(readSessionCookie(null)).toBeNull();
  });
});
