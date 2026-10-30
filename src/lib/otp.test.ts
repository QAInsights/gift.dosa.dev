import { beforeEach, describe, expect, it } from "vitest";
import { AuthError } from "./auth";
import { requestCode, sessionUser, signOut, verifyCode } from "./otp";
import type { Db, DbStatement, OtpRow, SessionRow, UserRow } from "./db";

class FakeStatement implements DbStatement {
  constructor(
    private db: FakeDb,
    private query: string,
    private values: unknown[] = [],
  ) {}

  bind(...values: unknown[]): DbStatement {
    return new FakeStatement(this.db, this.query, values);
  }

  async first<T>(): Promise<T | null> {
    const [a, b] = this.values as [string, number];
    if (this.query.startsWith("SELECT COUNT")) {
      const n = this.db.otps.filter((o) => o.email === a && o.created_at > (b as number)).length;
      return { n } as T;
    }
    if (this.query.includes("FROM otp_codes WHERE email")) {
      const live = this.db.otps
        .filter((o) => o.email === a && o.used_at === null && o.expires_at > (b as number))
        .sort((x, y) => y.created_at - x.created_at);
      return (live[0] ?? null) as T | null;
    }
    if (this.query.includes("FROM users WHERE email")) {
      return (this.db.users.find((u) => u.email === a) ?? null) as T | null;
    }
    if (this.query.includes("FROM sessions s JOIN users")) {
      const session = this.db.sessions.find((s) => s.token_hash === a && s.expires_at > (b as number));
      const user = session ? this.db.users.find((u) => u.id === session.user_id) : undefined;
      return (user ?? null) as T | null;
    }
    throw new Error(`unexpected query: ${this.query}`);
  }

  async all<T>(): Promise<{ results: T[] }> {
    return { results: [] };
  }

  async run(): Promise<unknown> {
    const v = this.values as [string, string, string, string, number, number];
    if (this.query.startsWith("INSERT INTO users")) {
      this.db.users.push({ id: v[0], email: v[1], name: (v[2] as string | null) ?? null, created_at: v[3] as unknown as number, updated_at: v[4] as unknown as number });
      return {};
    }
    if (this.query.startsWith("INSERT INTO otp_codes")) {
      this.db.otps.push({
        id: v[0],
        email: v[1],
        code_hash: v[2],
        salt: v[3],
        expires_at: v[4] as unknown as number,
        attempts: 0,
        used_at: null,
        created_at: v[5] as unknown as number,
      });
      return {};
    }
    if (this.query.startsWith("INSERT INTO sessions")) {
      this.db.sessions.push({
        id: v[0],
        token_hash: v[1],
        user_id: v[2],
        expires_at: v[3] as unknown as number,
        created_at: v[4] as unknown as number,
      });
      return {};
    }
    if (this.query.startsWith("UPDATE otp_codes SET attempts")) {
      const row = this.db.otps.find((o) => o.id === (this.values[1] as string));
      if (row) row.attempts = this.values[0] as number;
      return {};
    }
    if (this.query.startsWith("UPDATE otp_codes SET used_at")) {
      const row = this.db.otps.find((o) => o.id === (this.values[1] as string));
      if (row) row.used_at = this.values[0] as number;
      return {};
    }
    if (this.query.startsWith("DELETE FROM sessions")) {
      this.db.sessions = this.db.sessions.filter((s) => s.token_hash !== this.values[0]);
      return {};
    }
    throw new Error(`unexpected query: ${this.query}`);
  }
}

class FakeDb implements Db {
  users: UserRow[] = [];
  otps: OtpRow[] = [];
  sessions: SessionRow[] = [];

  prepare(query: string): DbStatement {
    return new FakeStatement(this, query);
  }
}

const NOW = 1_790_000_000_000;
let db: FakeDb;

beforeEach(() => {
  db = new FakeDb();
});

async function expectAuthError(promise: Promise<unknown>, status: number): Promise<void> {
  try {
    await promise;
    expect.unreachable();
  } catch (error) {
    expect(error).toBeInstanceOf(AuthError);
    expect((error as AuthError).status).toBe(status);
  }
}

describe("requestCode", () => {
  it("stores only a salted hash, never the code", async () => {
    const { code, email } = await requestCode(db, "Ada@Example.com", NOW);
    expect(code).toMatch(/^\d{6}$/);
    expect(email).toBe("ada@example.com");
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
