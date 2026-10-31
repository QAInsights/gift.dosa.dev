import { expect } from "vitest";
import { AuthError } from "./auth";
import type { CardRow, Db, DbStatement, DrawerRow, OtpRow, PrefsRow, ReminderRow, SessionRow, TodoRow, UserRow, WhatsappLinkRow, WhatsappPendingRow } from "./db";

export interface FakeSessionRow extends SessionRow {
  unlocked: string;
}

export async function expectAuthError(promise: Promise<unknown>, status: number): Promise<void> {
  try {
    await promise;
    expect.unreachable();
  } catch (error) {
    expect(error).toBeInstanceOf(AuthError);
    expect((error as AuthError).status).toBe(status);
  }
}

class FakeStatement implements DbStatement {
  private values: unknown[] = [];

  constructor(
    private db: FakeDb,
    private query: string,
    values: unknown[] = [],
  ) {
    this.values = values;
  }

  bind(...values: unknown[]): DbStatement {
    return new FakeStatement(this.db, this.query, values);
  }

  async first<T>(): Promise<T | null> {
    const q = this.query;
    const [a, b] = this.values as [string, number | string];
    if (q.startsWith("SELECT COUNT(*) AS n FROM otp_codes")) {
      const n = this.db.otps.filter((o) => o.email === a && o.created_at > (b as number)).length;
      return { n } as T;
    }
    if (q.includes("FROM otp_codes WHERE email")) {
      const live = this.db.otps
        .filter((o) => o.email === a && o.used_at === null && o.expires_at > (b as number))
        .sort((x, y) => y.created_at - x.created_at);
      return (live[0] ?? null) as T | null;
    }
    if (q.includes("FROM users WHERE email")) {
      return (this.db.users.find((u) => u.email === a) ?? null) as T | null;
    }
    if (q.includes("FROM sessions s JOIN users")) {
      const session = this.db.sessions.find((s) => s.token_hash === a && s.expires_at > (b as number));
      const user = session ? this.db.users.find((u) => u.id === session.user_id) : undefined;
      if (!user) return null;
      return { ...user, unlocked: session?.unlocked ?? "[]" } as T;
    }
    if (q.includes("FROM drawers WHERE id = ? AND user_id = ?")) {
      return (this.db.drawers.find((d) => d.id === a && d.user_id === b) ?? null) as T | null;
    }
    if (q.includes("FROM drawers WHERE user_id = ? AND name = ?")) {
      const name = String(b).toLowerCase();
      return (this.db.drawers.find((d) => d.user_id === a && d.name.toLowerCase() === name) ?? null) as T | null;
    }
    if (q.startsWith("SELECT COUNT(*) AS n FROM cards WHERE drawer_id")) {
      const n = this.db.cards.filter((c) => c.drawer_id === a && c.user_id === b).length;
      return { n } as T;
    }
    if (q.includes("FROM cards WHERE id = ? AND user_id = ?")) {
      return (this.db.cards.find((c) => c.id === a && c.user_id === b) ?? null) as T | null;
    }
    if (q.includes("FROM reminders WHERE card_id")) {
      return (this.db.reminders.find((r) => r.card_id === a && r.user_id === b) ?? null) as T | null;
    }
    if (q.includes("FROM users WHERE id")) {
      return (this.db.users.find((u) => u.id === a) ?? null) as T | null;
    }
    if (q.includes("FROM prefs WHERE user_id")) {
      return (this.db.prefs.find((p) => p.user_id === a) ?? null) as T | null;
    }
    if (q.includes("FROM todos WHERE id")) {
      return (this.db.todos.find((t) => t.id === a && t.user_id === b) ?? null) as T | null;
    }
    if (q.includes("FROM whatsapp_links WHERE user_id")) {
      return (this.db.waLinks.find((l) => l.user_id === a) ?? null) as T | null;
    }
    if (q.includes("FROM whatsapp_links WHERE phone")) {
      return (this.db.waLinks.find((l) => l.phone === a) ?? null) as T | null;
    }
    if (q.startsWith("DELETE FROM whatsapp_pending")) {
      const idx = this.db.waPending.findIndex((p) => p.id === a && p.user_id === b);
      if (idx < 0) return null;
      const [row] = this.db.waPending.splice(idx, 1);
      return row as T;
    }
    throw new Error(`unexpected query: ${this.query}`);
  }

  async all<T>(): Promise<{ results: T[] }> {
    const q = this.query;
    const [a] = this.values as [string];
    if (q.includes("FROM drawers WHERE user_id = ? ORDER BY")) {
      const results = this.db.drawers
        .filter((d) => d.user_id === a)
        .sort((x, y) => (x.name < y.name ? -1 : x.name > y.name ? 1 : 0));
      return { results: results as T[] };
    }
    if (q.includes("FROM todos WHERE user_id")) {
      const results = this.db.todos
        .filter((t) => t.user_id === a)
        .sort((x, y) => x.done - y.done || y.created_at - x.created_at);
      return { results: results as T[] };
    }
    if (q.includes("FROM otp_codes WHERE email")) {
      const results = this.db.otps
        .filter((o) => o.email === a && o.used_at === null && o.expires_at > (this.values[1] as number))
        .sort((x, y) => y.created_at - x.created_at);
      return { results: results as T[] };
    }
    if (q.startsWith("SELECT drawer_id, currency, SUM(balance_cents)")) {
      const sums = new Map<string, { drawer_id: string; currency: string; cents: number }>();
      for (const card of this.db.cards) {
        if (card.user_id !== a || !card.drawer_id) continue;
        const key = `${card.drawer_id}|${card.currency}`;
        const entry = sums.get(key) ?? { drawer_id: card.drawer_id, currency: card.currency, cents: 0 };
        entry.cents += card.balance_cents;
        sums.set(key, entry);
      }
      return { results: [...sums.values()] as T[] };
    }
    if (q.startsWith("SELECT drawer_id, COUNT(*) AS n FROM cards")) {
      const counts = new Map<string, number>();
      for (const card of this.db.cards) {
        if (card.user_id === a && card.drawer_id) counts.set(card.drawer_id, (counts.get(card.drawer_id) ?? 0) + 1);
      }
      const results = [...counts].map(([drawer_id, n]) => ({ drawer_id, n }));
      return { results: results as T[] };
    }
    if (q.includes("FROM cards WHERE user_id = ?")) {
      return { results: this.db.cards.filter((c) => c.user_id === a) as T[] };
    }
    if (q.includes("FROM reminders r JOIN cards")) {
      const results = this.db.reminders
        .filter((r) => r.channel === "email")
        .flatMap((r) => {
          const card = this.db.cards.find((c) => c.id === r.card_id && c.user_id === r.user_id);
          const user = this.db.users.find((u) => u.id === r.user_id);
          if (!card || !user || card.is_memory === 1 || card.sample === 1) return [];
          if (card.drawer_id) {
            const drawer = this.db.drawers.find((d) => d.id === card.drawer_id);
            if (drawer?.lock_hash) return [];
          }
          return [{
            reminder_id: r.id, email: user.email, retailer: card.retailer,
            balance_cents: card.balance_cents, currency: card.currency, expiry: card.expiry,
            days_before: r.days_before, last_sent_at: r.last_sent_at,
          }];
        })
        .sort((x, y) => {
          const a = x.expiry ?? "";
          const b = y.expiry ?? "";
          return a < b ? -1 : a > b ? 1 : 0;
        });
      return { results: results as T[] };
    }
    throw new Error(`unexpected query: ${this.query}`);
  }

  async run(): Promise<{ meta?: { changes?: number } }> {
    const q = this.query;
    const v = this.values as [string, string, string, string, number, number];
    if (q.startsWith("INSERT INTO users")) {
      if (this.db.users.some((u) => u.email === v[1])) {
        throw new Error("UNIQUE constraint failed: users.email");
      }
      this.db.users.push({
        id: v[0], email: v[1], name: (v[2] as string | null) ?? null,
        created_at: v[3] as unknown as number, updated_at: v[4] as unknown as number,
      });
      return {};
    }
    if (q.startsWith("INSERT INTO otp_codes")) {
      this.db.otps.push({
        id: v[0], email: v[1], code_hash: v[2], salt: v[3], expires_at: v[4] as unknown as number,
        attempts: 0, used_at: null, created_at: v[5] as unknown as number,
      });
      return {};
    }
    if (q.startsWith("INSERT INTO sessions")) {
      this.db.sessions.push({
        id: v[0], token_hash: v[1], user_id: v[2], expires_at: v[3] as unknown as number,
        created_at: v[4] as unknown as number, unlocked: "[]",
      });
      return {};
    }
    if (q.startsWith("UPDATE otp_codes SET attempts")) {
      const row = this.db.otps.find((o) => o.id === (this.values[1] as string));
      if (row) row.attempts = this.values[0] as number;
      return {};
    }
    if (q.startsWith("UPDATE otp_codes SET used_at = ? WHERE id = ? AND used_at IS NULL")) {
      const [now, id] = this.values as [number, string];
      const row = this.db.otps.find((o) => o.id === id);
      if (row && row.used_at === null) {
        row.used_at = now;
        return { meta: { changes: 1 } };
      }
      return { meta: { changes: 0 } };
    }
    if (q.startsWith("UPDATE otp_codes SET used_at")) {
      const row = this.db.otps.find((o) => o.id === (this.values[1] as string));
      if (row) row.used_at = this.values[0] as number;
      return {};
    }
    if (q.startsWith("DELETE FROM otp_codes")) {
      this.db.otps = this.db.otps.filter((o) => o.id !== this.values[0]);
      return {};
    }
    if (q.startsWith("DELETE FROM sessions")) {
      this.db.sessions = this.db.sessions.filter((s) => s.token_hash !== this.values[0]);
      return {};
    }
    if (q.startsWith("INSERT INTO drawers")) {
      const w = this.values as (string | number | null)[];
      const name = String(w[2]).toLowerCase();
      if (this.db.drawers.some((d) => d.user_id === w[1] && d.name.toLowerCase() === name)) {
        throw new Error("UNIQUE constraint failed: drawers.user_id, drawers.name");
      }
      this.db.drawers.push({
        id: w[0] as string, user_id: w[1] as string, name: w[2] as string, emoji: w[3] as string | null,
        lock_hash: w[4] as string | null, login_attempts: w[5] as number, locked_until: w[6] as number,
        created_at: w[7] as number, updated_at: w[8] as number,
      });
      return {};
    }
    if (q.startsWith("UPDATE drawers SET emoji")) {
      const [emoji, now, id, userId] = this.values as [string, number, string, string];
      const row = this.db.drawers.find((d) => d.id === id && d.user_id === userId);
      if (row) {
        row.emoji = emoji;
        row.updated_at = now;
      }
      return {};
    }
    if (q.startsWith("INSERT INTO todos")) {
      const w = this.values as (string | number)[];
      this.db.todos.push({
        id: w[0] as string, user_id: w[1] as string, text: w[2] as string,
        done: w[3] as number, created_at: w[4] as number, updated_at: w[5] as number,
      });
      return {};
    }
    if (q.startsWith("UPDATE todos SET")) {
      const [text, done, now, id, userId] = this.values as [string, number, number, string, string];
      const row = this.db.todos.find((t) => t.id === id && t.user_id === userId);
      if (row) {
        row.text = text;
        row.done = done;
        row.updated_at = now;
      }
      return {};
    }
    if (q.startsWith("DELETE FROM todos")) {
      const [id, userId] = this.values as [string, string];
      this.db.todos = this.db.todos.filter((t) => !(t.id === id && t.user_id === userId));
      return {};
    }
    if (q.startsWith("INSERT INTO whatsapp_links")) {
      const [userId, phone, code, verifiedAt, createdAt] = this.values as [string, string, string, number | null, number];
      if (this.db.waLinks.some((l) => l.phone === phone && l.user_id !== userId)) {
        throw new Error("UNIQUE constraint failed: whatsapp_links.phone");
      }
      this.db.waLinks = this.db.waLinks.filter((l) => l.user_id !== userId);
      this.db.waLinks.push({ user_id: userId, phone, code, verified_at: verifiedAt, created_at: createdAt });
      return {};
    }
    if (q.startsWith("UPDATE whatsapp_links SET verified_at")) {
      const [now, userId] = this.values as [number, string];
      const row = this.db.waLinks.find((l) => l.user_id === userId);
      if (row) row.verified_at = now;
      return {};
    }
    if (q.startsWith("DELETE FROM whatsapp_links")) {
      const [userId] = this.values as [string];
      this.db.waLinks = this.db.waLinks.filter((l) => l.user_id !== userId);
      return {};
    }
    if (q.startsWith("INSERT INTO whatsapp_pending")) {
      const [id, userId, phone, payload, createdAt] = this.values as [string, string, string, string, number];
      this.db.waPending.push({ id, user_id: userId, phone, payload, created_at: createdAt });
      return {};
    }
    if (q.startsWith("UPDATE drawers SET name")) {
      const [name, now, id, userId] = this.values as [string, number, string, string];
      if (this.db.drawers.some((d) => d.user_id === userId && d.name.toLowerCase() === name.toLowerCase() && d.id !== id)) {
        throw new Error("UNIQUE constraint failed: drawers.user_id, drawers.name");
      }
      const row = this.db.drawers.find((d) => d.id === id && d.user_id === userId);
      if (row) {
        row.name = name;
        row.updated_at = now;
      }
      return {};
    }
    if (q.startsWith("UPDATE drawers SET login_attempts")) {
      const [attempts, lockedUntil, now, id, userId] = this.values as [number, number, number, string, string];
      const row = this.db.drawers.find((d) => d.id === id && d.user_id === userId);
      if (row) {
        row.login_attempts = attempts;
        row.locked_until = lockedUntil;
        row.updated_at = now;
      }
      return {};
    }
    if (q.startsWith("UPDATE drawers SET lock_hash")) {
      const [hash, now, id, userId] = this.values as [string | null, number, string, string];
      const row = this.db.drawers.find((d) => d.id === id && d.user_id === userId);
      if (row) {
        row.lock_hash = hash;
        row.updated_at = now;
      }
      return {};
    }
    if (q.startsWith("DELETE FROM drawers")) {
      const [id, userId] = this.values as [string, string];
      this.db.drawers = this.db.drawers.filter((d) => !(d.id === id && d.user_id === userId));
      return {};
    }
    if (q.startsWith("UPDATE cards SET vault_number = NULL")) {
      const [drawerId, userId] = this.values as [string, string];
      for (const card of this.db.cards) {
        if (card.drawer_id === drawerId && card.user_id === userId) {
          card.vault_number = null;
          card.vault_pin = null;
        }
      }
      return {};
    }
    if (q.startsWith("UPDATE cards SET drawer_id = NULL")) {
      const [drawerId, userId] = this.values as [string, string];
      for (const card of this.db.cards) {
        if (card.drawer_id === drawerId && card.user_id === userId) card.drawer_id = null;
      }
      return {};
    }
    if (q.startsWith("UPDATE sessions SET unlocked")) {
      const [unlocked, tokenHash] = this.values as [string, string];
      const row = this.db.sessions.find((s) => s.token_hash === tokenHash);
      if (row) row.unlocked = unlocked;
      return {};
    }
    if (q.startsWith("INSERT INTO cards")) {
      const w = this.values as (string | number | null)[];
      this.db.cards.push({
        id: w[0] as string, user_id: w[1] as string, drawer_id: w[2] as string | null,
        retailer: w[3] as string, nickname: w[4] as string | null, last4: w[5] as string | null,
        balance_cents: w[6] as number, currency: w[7] as string, expiry: w[8] as string | null,
        occasion: w[9] as string | null, tags: w[10] as string, notes: w[11] as string | null,
        receipt_url: w[12] as string | null, is_memory: w[13] as number, sample: w[14] as number,
        vault_number: w[15] as string | null, vault_pin: w[16] as string | null,
        created_at: w[17] as number, updated_at: w[18] as number,
      });
      return {};
    }
    if (q.startsWith("UPDATE cards SET drawer_id = ?, retailer")) {
      const w = this.values as (string | number | null)[];
      const row = this.db.cards.find((c) => c.id === w[12] && c.user_id === w[13]);
      if (row) {
        row.drawer_id = w[0] as string | null;
        row.retailer = w[1] as string;
        row.nickname = w[2] as string | null;
        row.last4 = w[3] as string | null;
        row.balance_cents = w[4] as number;
        row.currency = w[5] as string;
        row.expiry = w[6] as string | null;
        row.occasion = w[7] as string | null;
        row.tags = w[8] as string;
        row.notes = w[9] as string | null;
        row.is_memory = w[10] as number;
        row.updated_at = w[11] as number;
      }
      return {};
    }
    if (q.startsWith("UPDATE cards SET vault_number")) {
      const [number, pin, now, id, userId] = this.values as [string | null, string | null, number, string, string];
      const row = this.db.cards.find((c) => c.id === id && c.user_id === userId);
      if (row) {
        row.vault_number = number;
        row.vault_pin = pin;
        row.updated_at = now;
      }
      return {};
    }
    if (q.startsWith("INSERT INTO reminders")) {
      const w = this.values as (string | number | null)[];
      if (this.db.reminders.some((r) => r.user_id === w[1] && r.card_id === w[2])) {
        throw new Error("UNIQUE constraint failed: reminders.user_id, reminders.card_id");
      }
      this.db.reminders.push({
        id: w[0] as string, user_id: w[1] as string, card_id: w[2] as string,
        days_before: w[3] as number, channel: w[4] as string,
        last_sent_at: w[5] as number | null, created_at: w[6] as number,
      });
      return {};
    }
    if (q.startsWith("UPDATE users SET name")) {
      const [name, now, id] = this.values as [string | null, number, string];
      const row = this.db.users.find((u) => u.id === id);
      if (row) {
        row.name = name;
        row.updated_at = now;
      }
      return {};
    }
    if (q.startsWith("UPDATE reminders SET last_sent_at = NULL")) {
      const [cardId, userId] = this.values as [string, string];
      const row = this.db.reminders.find((r) => r.card_id === cardId && r.user_id === userId);
      if (row) row.last_sent_at = null;
      return {};
    }
    if (q.startsWith("UPDATE reminders SET last_sent_at = ? WHERE id = ? AND last_sent_at IS ?")) {
      const [now, id, expected] = this.values as [number, string, number | null];
      const row = this.db.reminders.find((r) => r.id === id);
      if (row && row.last_sent_at === expected) {
        row.last_sent_at = now;
        return { meta: { changes: 1 } };
      }
      return { meta: { changes: 0 } };
    }
    if (q.startsWith("UPDATE reminders SET last_sent_at = ? WHERE id = ? AND last_sent_at = ?")) {
      const [restore, id, claimedAt] = this.values as [number | null, string, number];
      const row = this.db.reminders.find((r) => r.id === id);
      if (row && row.last_sent_at === claimedAt) row.last_sent_at = restore;
      return {};
    }
    if (q.startsWith("INSERT INTO prefs")) {
      const w = this.values as (string | number | null)[];
      const next: PrefsRow = {
        user_id: w[0] as string, region: w[1] as string | null, currency: w[2] as string | null,
        date_format: w[3] as string | null, updated_at: w[4] as number,
      };
      const at = this.db.prefs.findIndex((p) => p.user_id === next.user_id);
      if (at >= 0) this.db.prefs[at] = next;
      else this.db.prefs.push(next);
      return {};
    }
    if (q.startsWith("DELETE FROM reminders")) {
      const [cardId, userId] = this.values as [string, string];
      this.db.reminders = this.db.reminders.filter((r) => !(r.card_id === cardId && r.user_id === userId));
      return {};
    }
    if (q.startsWith("DELETE FROM cards WHERE user_id")) {
      const [userId] = this.values as [string];
      const gone = new Set(this.db.cards.filter((c) => c.user_id === userId && c.sample === 1).map((c) => c.id));
      this.db.cards = this.db.cards.filter((c) => !gone.has(c.id));
      this.db.reminders = this.db.reminders.filter((r) => !gone.has(r.card_id));
      return {};
    }
    if (q.startsWith("DELETE FROM cards")) {
      const [id, userId] = this.values as [string, string];
      this.db.cards = this.db.cards.filter((c) => !(c.id === id && c.user_id === userId));
      this.db.reminders = this.db.reminders.filter((r) => r.card_id !== id);
      return {};
    }
    throw new Error(`unexpected query: ${this.query}`);
  }
}

export class FakeDb implements Db {
  users: UserRow[] = [];
  otps: OtpRow[] = [];
  sessions: FakeSessionRow[] = [];
  drawers: DrawerRow[] = [];
  cards: CardRow[] = [];
  reminders: ReminderRow[] = [];
  prefs: PrefsRow[] = [];
  todos: TodoRow[] = [];
  waLinks: WhatsappLinkRow[] = [];
  waPending: WhatsappPendingRow[] = [];

  prepare(query: string): DbStatement {
    return new FakeStatement(this, query);
  }
}
