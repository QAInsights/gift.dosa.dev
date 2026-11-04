import { describe, expect, it } from "vitest";
import type { AiConfig } from "./ai";
import type { AskCard } from "./ask";
import { createCard, updateCard } from "./cards";
import { createDrawer } from "./drawers";
import { findWhatsappLinkByUser } from "./db";
import { expectAuthError, FakeDb } from "./fake-db";
import {
  confirmLinkCode,
  downloadMedia,
  fetchMediaUrl,
  generateLinkCode,
  handleInboundEvent,
  matchRetailer,
  normalizePhone,
  parseBalanceIntent,
  parseWebhookEvents,
  sendButtonsMessage,
  sendListMessage,
  sendTextMessage,
  startLink,
  summarizeExtraction,
  verifyHandshake,
  verifyWebhookSignature,
  whatsappConfigFromEnv,
  whatsappEnv,
  type WhatsappConfig,
} from "./whatsapp";

const USER = "user-wa";
const PHONE = "15551234567";
const NOW = Date.parse("2026-10-31T12:00:00Z");
const CONFIG: WhatsappConfig = { token: "wa-token", phoneId: "100289156039369" };
const AI: AiConfig = { endpoint: "https://model.test/v1", model: "muse-test", apiKey: "key" };

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

interface ListBody {
  type: string;
  body: { text: string };
  action: { sections: Array<{ title: string; rows: Array<{ id: string; title: string }> }> };
}

describe("whatsappConfigFromEnv", () => {
  it("reads token and phone id", () => {
    expect(whatsappConfigFromEnv({ WHATSAPP_TOKEN: "t", WHATSAPP_PHONE_ID: "p" })).toEqual({ token: "t", phoneId: "p" });
    expect(whatsappConfigFromEnv({ WHATSAPP_TOKEN: "t" })).toBeNull();
    expect(whatsappConfigFromEnv({})).toBeNull();
  });

  it("bundles config, ai, and verify token", () => {
    const env = {
      WHATSAPP_TOKEN: "t",
      WHATSAPP_PHONE_ID: "p",
      WHATSAPP_VERIFY_TOKEN: "v",
      WHATSAPP_APP_SECRET: "s",
      META_AI_ENDPOINT: "https://model.test",
      META_AI_MODEL: "m",
      META_AI_API_KEY: "k",
    };
    const out = whatsappEnv(env);
    expect(out.config).toEqual({ token: "t", phoneId: "p" });
    expect(out.ai).not.toBeNull();
    expect(out.verifyToken).toBe("v");
    expect(out.appSecret).toBe("s");
    expect(whatsappEnv({}).appSecret).toBeUndefined();
  });
});

describe("verifyHandshake", () => {
  it("returns the challenge only for a matching subscribe", () => {
    const good = new URL("https://x.test/?hub.mode=subscribe&hub.verify_token=s3cret&hub.challenge=abc");
    expect(verifyHandshake(good, "s3cret")).toBe("abc");
    const wrong = new URL("https://x.test/?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=abc");
    expect(verifyHandshake(wrong, "s3cret")).toBeNull();
    const missing = new URL("https://x.test/?hub.mode=subscribe&hub.verify_token=s3cret");
    expect(verifyHandshake(missing, "s3cret")).toBeNull();
    expect(verifyHandshake(good, undefined)).toBeNull();
  });
});

describe("verifyWebhookSignature", () => {
  const SECRET = "app-secret-for-tests";
  const BODY = '{"entry":[{"changes":[{"value":{"messages":[]}}]}]}';
  const sign = async (body: string, secret: string) => {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
    return `sha256=${[...new Uint8Array(mac)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  };

  it("accepts a valid Meta signature", async () => {
    await expect(verifyWebhookSignature(BODY, await sign(BODY, SECRET), SECRET)).resolves.toBe(true);
  });

  it("rejects tampered bodies, wrong secrets, and malformed headers", async () => {
    const good = await sign(BODY, SECRET);
    await expect(verifyWebhookSignature(`${BODY} `, good, SECRET)).resolves.toBe(false);
    await expect(verifyWebhookSignature(BODY, good, "other-secret")).resolves.toBe(false);
    await expect(verifyWebhookSignature(BODY, null, SECRET)).resolves.toBe(false);
    await expect(verifyWebhookSignature(BODY, "sha256=xyz", SECRET)).resolves.toBe(false);
    await expect(verifyWebhookSignature(BODY, good.replace("sha256=", "sha1="), SECRET)).resolves.toBe(false);
  });
});

describe("parseWebhookEvents", () => {
  const entry = (messages: unknown[]) => ({ entry: [{ changes: [{ value: { messages } }] }] });

  it("parses text, image, button, and list replies", () => {
    const events = parseWebhookEvents(
      entry([
        { from: PHONE, type: "text", text: { body: "LINK ABC123" } },
        { from: PHONE, type: "image", image: { id: "media-1" } },
        { from: PHONE, type: "interactive", interactive: { button_reply: { id: "wa:file:x" } } },
        { from: PHONE, type: "interactive", interactive: { list_reply: { id: "wa:file:y" } } },
      ]),
    );
    expect(events).toEqual([
      { type: "text", from: PHONE, text: "LINK ABC123" },
      { type: "image", from: PHONE, mediaId: "media-1" },
      { type: "button", from: PHONE, id: "wa:file:x" },
      { type: "button", from: PHONE, id: "wa:file:y" },
    ]);
  });

  it("ignores statuses, unknown types, and garbage", () => {
    expect(parseWebhookEvents(entry([{ type: "status", from: PHONE }]))).toEqual([]);
    expect(parseWebhookEvents(entry([{ from: PHONE, type: "text" }]))).toEqual([]);
    expect(parseWebhookEvents(entry([{ type: "text", text: { body: "hi" } }]))).toEqual([]);
    expect(parseWebhookEvents({})).toEqual([]);
    expect(parseWebhookEvents(null)).toEqual([]);
    expect(parseWebhookEvents("nope")).toEqual([]);
  });
});

describe("normalizePhone", () => {
  it("keeps digit strings in range", () => {
    expect(normalizePhone("+1 (555) 123-4567")).toBe(PHONE);
    expect(normalizePhone(PHONE)).toBe(PHONE);
    expect(normalizePhone("123")).toBe("");
    expect(normalizePhone("1".repeat(16))).toBe("");
    expect(normalizePhone(123)).toBe("");
  });
});

describe("generateLinkCode", () => {
  it("builds a six-letter code from randomness", () => {
    const code = generateLinkCode((size) => new Uint8Array(Array.from({ length: size }, (_, i) => i)));
    expect(code).toMatch(/^[A-Z2-9]{6}$/);
    expect(generateLinkCode()).toMatch(/^[A-Z2-9]{6}$/);
  });
});

describe("linking", () => {
  it("starts a link with a fresh code", async () => {
    const db = new FakeDb();
    const row = await startLink(db, USER, "+1 (555) 123-4567", NOW);
    expect(row.phone).toBe(PHONE);
    expect(row.code).toMatch(/^[A-Z2-9]{6}$/);
    expect(row.verified_at).toBeNull();
  });

  it("rejects bad numbers and taken verified numbers", async () => {
    const db = new FakeDb();
    await expectAuthError(startLink(db, USER, "123", NOW), 400);
    const other = await startLink(db, "other-user", PHONE, NOW);
    expect(await confirmLinkCode(db, PHONE, other.code, NOW)).toBe("other-user");
    await expectAuthError(startLink(db, USER, PHONE, NOW), 409);
    const db2 = new FakeDb();
    await startLink(db2, "other-user", PHONE, NOW);
    const reclaim = await startLink(db2, USER, PHONE, NOW);
    expect(reclaim.user_id).toBe(USER);
  });

  it("confirms a matching code case-insensitively", async () => {
    const db = new FakeDb();
    const row = await startLink(db, USER, PHONE, NOW);
    expect(await confirmLinkCode(db, PHONE, row.code.toLowerCase(), NOW)).toBe(USER);
    expect(await confirmLinkCode(db, PHONE, "ZZZZZZ", NOW)).toBeNull();
    const row2 = await startLink(db, USER, PHONE, NOW);
    expect(await confirmLinkCode(db, "19998887777", row2.code, NOW)).toBe(USER);
    const rebound = await findWhatsappLinkByUser(db, USER);
    expect(rebound?.phone).toBe("19998887777");
    expect(rebound?.verified_at).toBe(NOW);
  });

  it("confirms when the typed number lacked a country code", async () => {
    const db = new FakeDb();
    const row = await startLink(db, USER, "5551234567", NOW);
    expect(await confirmLinkCode(db, "15551234567", row.code, NOW)).toBe(USER);
    const link = await findWhatsappLinkByUser(db, USER);
    expect(link?.phone).toBe("15551234567");
    expect(link?.verified_at).toBe(NOW);
  });

  it("refuses to steal a number verified for another user", async () => {
    const db = new FakeDb();
    const other = await startLink(db, "other-user", "15551234567", NOW);
    await confirmLinkCode(db, "15551234567", other.code, NOW);
    const row = await startLink(db, USER, "5551234567", NOW);
    expect(await confirmLinkCode(db, "15551234567", row.code, NOW)).toBeNull();
    const untouched = await findWhatsappLinkByUser(db, "other-user");
    expect(untouched?.phone).toBe("15551234567");
    expect(untouched?.verified_at).toBe(NOW);
    expect((await findWhatsappLinkByUser(db, USER))?.verified_at).toBeNull();
  });

  it("returns null for a wrong code with no phone match", async () => {
    const db = new FakeDb();
    await startLink(db, USER, "5551234567", NOW);
    expect(await confirmLinkCode(db, "15551234567", "ZZZZZZ", NOW)).toBeNull();
  });
});

describe("graph client", () => {
  it("sends text with bearer auth", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const fetchFn = (async (url: URL | string, init?: RequestInit) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return jsonResponse({ ok: true });
    }) as typeof fetch;
    await sendTextMessage(CONFIG, PHONE, "hello", fetchFn);
    expect(calls[0].url).toBe("https://graph.facebook.com/v23.0/100289156039369/messages");
    expect(calls[0].body).toMatchObject({ to: PHONE, type: "text", text: { body: "hello" } });
  });

  it("sends list messages and surfaces failures", async () => {
    const bodies: unknown[] = [];
    const ok = (async (_url: URL | string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return jsonResponse({ ok: true });
    }) as typeof fetch;
    await sendListMessage(CONFIG, PHONE, "Pick one:", "Open", [{ title: "S", rows: [{ id: "a", title: "A" }] }], ok);
    expect(bodies[0]).toMatchObject({ type: "interactive", interactive: { type: "list" } });
    const failing = (async () => new Response("no", { status: 401 })) as typeof fetch;
    await expect(sendTextMessage(CONFIG, PHONE, "hi", failing)).rejects.toThrow("401");
  });

  it("fetches media metadata and bytes with caps", async () => {
    const fetchFn = (async (url: URL | string) => {
      if (String(url).includes("/media-1")) return jsonResponse({ url: "https://cdn.test/m", mime_type: "image/jpeg" });
      return new Response(new Uint8Array([1, 2, 3]).buffer, {
        headers: { "content-type": "image/jpeg", "content-length": "3" },
      });
    }) as typeof fetch;
    const media = await fetchMediaUrl("t", "media-1", fetchFn);
    expect(media.url).toBe("https://cdn.test/m");
    const photo = await downloadMedia("t", media.url, fetchFn);
    expect(photo.bytes.byteLength).toBe(3);

    const huge = (async () => new Response(new Uint8Array([1]).buffer, {
      headers: { "content-type": "image/jpeg", "content-length": String(6_000_000) },
    })) as typeof fetch;
    await expect(downloadMedia("t", "https://cdn.test/m", huge)).rejects.toThrow("too large");
    const notImage = (async () => new Response("x", { headers: { "content-type": "text/plain" } })) as typeof fetch;
    await expect(downloadMedia("t", "https://cdn.test/m", notImage)).rejects.toThrow("not a photo");
  });
});

describe("summarizeExtraction", () => {
  it("joins present fields and returns null when empty", () => {
    expect(summarizeExtraction({ retailer: "Bookshop", balance: "25.00", expiry: "2027-01-01" })).toBe(
      "Bookshop · $25.00 · expires 2027-01-01",
    );
    expect(summarizeExtraction({})).toBeNull();
  });
});

describe("handleInboundEvent", () => {
  function router(sent: Array<{ to: string; body: unknown }>, modelFields: unknown = {}) {
    return (async (url: URL | string, init?: RequestInit) => {
      const target = String(url);
      if (target.includes("/messages")) {
        sent.push({ to: (JSON.parse(String(init?.body)) as { to: string }).to, body: JSON.parse(String(init?.body)) });
        return jsonResponse({ ok: true });
      }
      if (target.endsWith("/media-1")) return jsonResponse({ url: "https://cdn.test/m", mime_type: "image/jpeg" });
      if (target === "https://cdn.test/m") {
        return new Response(new Uint8Array([1, 2, 3]).buffer, { headers: { "content-type": "image/jpeg" } });
      }
      return jsonResponse({ choices: [{ message: { content: JSON.stringify(modelFields) } }] });
    }) as typeof fetch;
  }

  it("links on a matching code and rejects a wrong one", async () => {
    const db = new FakeDb();
    const row = await startLink(db, USER, PHONE, NOW);
    const sent: Array<{ to: string; body: unknown }> = [];
    await handleInboundEvent(db, CONFIG, null, { type: "text", from: PHONE, text: `LINK ${row.code}` }, { fetchFn: router(sent), now: NOW });
    expect(JSON.stringify(sent[0].body)).toContain("linked");
    await handleInboundEvent(db, CONFIG, null, { type: "text", from: PHONE, text: "LINK ZZZZZZ" }, { fetchFn: router(sent), now: NOW });
    expect(JSON.stringify(sent[1].body)).toContain("did not match");
  });

  it("asks unlinked senders to link first", async () => {
    const db = new FakeDb();
    const sent: Array<{ to: string; body: unknown }> = [];
    await handleInboundEvent(db, CONFIG, AI, { type: "image", from: PHONE, mediaId: "media-1" }, { fetchFn: router(sent), now: NOW });
    expect(JSON.stringify(sent[0].body)).toContain("Link this number first");
  });

  it("reads a photo and offers every open drawer", async () => {
    const db = new FakeDb();
    const row = await startLink(db, USER, PHONE, NOW);
    await confirmLinkCode(db, PHONE, row.code, NOW);
    const food = await createDrawer(db, USER, "Food", null, NOW);
    await createDrawer(db, USER, "Secret", "drawer-secret", NOW);
    const sent: Array<{ to: string; body: unknown }> = [];
    const fetchFn = router(sent, { retailer: "Bookshop", balance: "25.00", expiry: "2027-01-01" });
    await handleInboundEvent(db, CONFIG, AI, { type: "image", from: PHONE, mediaId: "media-1" }, { fetchFn, now: NOW });
    const interactive = (sent[0].body as { interactive: ListBody }).interactive;
    expect(interactive.type).toBe("list");
    expect(interactive.body.text).toContain("Bookshop");
    const titles = interactive.action.sections.flatMap((s) => s.rows.map((r) => r.title));
    expect(titles).toContain("Personal");
    expect(titles.some((t) => t.includes("Food"))).toBe(true);
    expect(titles.some((t) => t.includes("Secret"))).toBe(false);
    expect(interactive.body.text).toContain("sealed drawers hidden");
    const fileId = interactive.action.sections[0].rows.find((r) => r.title.includes("Food"))!.id;
    expect(fileId).toContain(food.id);
    expect(db.waPending).toHaveLength(1);
    await handleInboundEvent(db, CONFIG, AI, { type: "button", from: PHONE, id: fileId }, { fetchFn, now: NOW });
    expect(db.cards).toHaveLength(1);
    expect(db.cards[0].retailer).toBe("Bookshop");
    expect(db.cards[0].drawer_id).toBe(food.id);
    expect(db.waPending).toHaveLength(0);
    expect(JSON.stringify(sent[1].body)).toContain("is in Food");
  });

  it("files to Personal and still honors legacy callbacks", async () => {
    const db = new FakeDb();
    const row = await startLink(db, USER, PHONE, NOW);
    await confirmLinkCode(db, PHONE, row.code, NOW);
    const sent: Array<{ to: string; body: unknown }> = [];
    const fetchFn = router(sent, { retailer: "Bookshop", balance: "25.00" });
    await handleInboundEvent(db, CONFIG, AI, { type: "image", from: PHONE, mediaId: "media-1" }, { fetchFn, now: NOW });
    const interactive = (sent[0].body as { interactive: ListBody }).interactive;
    const personalId = interactive.action.sections[0].rows.find((r) => r.title === "Personal")!.id;
    await handleInboundEvent(db, CONFIG, AI, { type: "button", from: PHONE, id: personalId }, { fetchFn, now: NOW });
    expect(db.cards[0].drawer_id).toBeNull();
    expect(JSON.stringify(sent[1].body)).toContain("is in Personal");
    await handleInboundEvent(db, CONFIG, AI, { type: "image", from: PHONE, mediaId: "media-1" }, { fetchFn, now: NOW });
    const legacyId = `wa:file:${db.waPending[0].id}`;
    await handleInboundEvent(db, CONFIG, AI, { type: "button", from: PHONE, id: legacyId }, { fetchFn, now: NOW });
    expect(db.cards).toHaveLength(2);
    expect(db.cards[1].drawer_id).toBeNull();
  });

  it("discards without filing and reports stale trays", async () => {
    const db = new FakeDb();
    const row = await startLink(db, USER, PHONE, NOW);
    await confirmLinkCode(db, PHONE, row.code, NOW);
    const sent: Array<{ to: string; body: unknown }> = [];
    const fetchFn = router(sent, { retailer: "Bookshop", balance: "25.00" });
    await handleInboundEvent(db, CONFIG, AI, { type: "image", from: PHONE, mediaId: "media-1" }, { fetchFn, now: NOW });
    const interactive = (sent[0].body as { interactive: ListBody }).interactive;
    const discardId = interactive.action.sections[1].rows[0].id;
    await handleInboundEvent(db, CONFIG, AI, { type: "button", from: PHONE, id: discardId }, { fetchFn, now: NOW });
    expect(db.cards).toHaveLength(0);
    expect(JSON.stringify(sent[1].body)).toContain("Discarded");
    await handleInboundEvent(db, CONFIG, AI, { type: "button", from: PHONE, id: discardId }, { fetchFn, now: NOW });
    expect(JSON.stringify(sent[2].body)).toContain("already left the tray");
  });

  it("says so when nothing is readable", async () => {
    const db = new FakeDb();
    const row = await startLink(db, USER, PHONE, NOW);
    await confirmLinkCode(db, PHONE, row.code, NOW);
    const sent: Array<{ to: string; body: unknown }> = [];
    await handleInboundEvent(db, CONFIG, AI, { type: "image", from: PHONE, mediaId: "media-1" }, { fetchFn: router(sent, {}), now: NOW });
    expect(JSON.stringify(sent[0].body)).toContain("Nothing readable");
  });
});

describe("parseBalanceIntent", () => {
  it("parses spend statements", () => {
    expect(parseBalanceIntent("spent 12.50 at Bookshop")).toEqual({ op: "spend", cents: 1250, retailer: "Bookshop" });
    expect(parseBalanceIntent("Used $5 on Target!")).toEqual({ op: "spend", cents: 500, retailer: "Target" });
    expect(parseBalanceIntent("paid 1,000 from Costco")).toEqual({ op: "spend", cents: 100000, retailer: "Costco" });
    expect(parseBalanceIntent("redeemed 3.5 with Steam")).toEqual({ op: "spend", cents: 350, retailer: "Steam" });
  });

  it("parses set statements", () => {
    expect(parseBalanceIntent("set Bookshop to 20")).toEqual({ op: "set", cents: 2000, retailer: "Bookshop" });
    expect(parseBalanceIntent("Starbucks now $30.25")).toEqual({ op: "set", cents: 3025, retailer: "Starbucks" });
    expect(parseBalanceIntent("Target is now 15")).toEqual({ op: "set", cents: 1500, retailer: "Target" });
  });

  it("ignores questions, links, and bad amounts", () => {
    expect(parseBalanceIntent("What expires first?")).toBeNull();
    expect(parseBalanceIntent("How much do I have?")).toBeNull();
    expect(parseBalanceIntent("LINK ABC123")).toBeNull();
    expect(parseBalanceIntent("hi")).toBeNull();
    expect(parseBalanceIntent("spent at Bookshop")).toBeNull();
    expect(parseBalanceIntent("spent 0 at Bookshop")).toBeNull();
    expect(parseBalanceIntent("spent 12.555 at Bookshop")).toBeNull();
    expect(parseBalanceIntent("set Bookshop to lots")).toBeNull();
  });
});

describe("matchRetailer", () => {
  const card = (retailer: string) => ({ retailer }) as AskCard;
  const cards = [card("Bookshop"), card("Target"), card("Target Gift")];

  it("prefers exact matches, then substring and word matches", () => {
    expect(matchRetailer(cards, "Target")).toHaveLength(1);
    expect(matchRetailer(cards, "book")).toEqual([cards[0]]);
    expect(matchRetailer(cards, "gift target")).toEqual([cards[2]]);
    expect(matchRetailer(cards, "Steam")).toHaveLength(0);
    expect(matchRetailer(cards, "  ")).toHaveLength(0);
  });

  it("returns every ambiguous match", () => {
    expect(matchRetailer(cards, "targ")).toHaveLength(2);
  });
});

describe("sendButtonsMessage", () => {
  it("sends reply buttons", async () => {
    const bodies: unknown[] = [];
    const ok = (async (_url: URL | string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;
    await sendButtonsMessage(CONFIG, PHONE, "Confirm?", [{ id: "yes", title: "Confirm" }], ok);
    expect(bodies[0]).toMatchObject({
      type: "interactive",
      interactive: { type: "button", action: { buttons: [{ type: "reply", reply: { id: "yes", title: "Confirm" } }] } },
    });
  });
});

describe("spending companion", () => {
  function router(sent: Array<{ to: string; body: unknown }>) {
    return (async (url: URL | string, init?: RequestInit) => {
      sent.push({ to: (JSON.parse(String(init?.body)) as { to: string }).to, body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;
  }

  async function linkedDb() {
    const db = new FakeDb();
    const row = await startLink(db, USER, PHONE, NOW);
    await confirmLinkCode(db, PHONE, row.code, NOW);
    await createCard(db, USER, { retailer: "Bookshop", balance: "25.00", expiry: "2027-01-01" }, [], NOW);
    return db;
  }

  interface ButtonBody {
    interactive: { type: string; body: { text: string }; action: { buttons: Array<{ reply: { id: string; title: string } }> } };
  }

  it("answers linked questions from the shelf", async () => {
    const db = await linkedDb();
    const sent: Array<{ to: string; body: unknown }> = [];
    await handleInboundEvent(db, CONFIG, null, { type: "text", from: PHONE, text: "What expires first?" }, { fetchFn: router(sent), now: NOW });
    expect(JSON.stringify(sent[0].body)).toContain("Bookshop");
  });

  it("asks unlinked text senders to link first", async () => {
    const db = new FakeDb();
    const sent: Array<{ to: string; body: unknown }> = [];
    await handleInboundEvent(db, CONFIG, null, { type: "text", from: PHONE, text: "What expires first?" }, { fetchFn: router(sent), now: NOW });
    expect(JSON.stringify(sent[0].body)).toContain("Link this number first");
  });

  it("throttles rapid questions per user", async () => {
    const db = new FakeDb();
    const phone = "15557654321";
    const row = await startLink(db, "user-wa-throttle", phone, NOW);
    await confirmLinkCode(db, phone, row.code, NOW);
    const sent: Array<{ to: string; body: unknown }> = [];
    const fetchFn = router(sent);
    for (let i = 0; i < 10; i++) {
      await handleInboundEvent(db, CONFIG, null, { type: "text", from: phone, text: "How much do I have?" }, { fetchFn, now: NOW });
    }
    expect(JSON.stringify(sent[9].body)).not.toContain("Too many questions");
    await handleInboundEvent(db, CONFIG, null, { type: "text", from: phone, text: "How much do I have?" }, { fetchFn, now: NOW });
    expect(JSON.stringify(sent[10].body)).toContain("Too many questions");
  });

  it("proposes a spend and applies it only on confirm", async () => {
    const db = await linkedDb();
    const sent: Array<{ to: string; body: unknown }> = [];
    const fetchFn = router(sent);
    await handleInboundEvent(db, CONFIG, null, { type: "text", from: PHONE, text: "spent 5 at Bookshop" }, { fetchFn, now: NOW });
    const proposal = (sent[0].body as ButtonBody).interactive;
    expect(proposal.type).toBe("button");
    expect(proposal.body.text).toContain("from $25.00 to $20.00");
    expect(db.cards[0].balance_cents).toBe(2500);
    const yes = proposal.action.buttons.find((b) => b.reply.title === "Confirm")!.reply.id;
    await handleInboundEvent(db, CONFIG, null, { type: "button", from: PHONE, id: yes }, { fetchFn, now: NOW });
    expect(db.cards[0].balance_cents).toBe(2000);
    expect(JSON.stringify(sent[1].body)).toContain("now $20.00");
  });

  it("cancels without touching the balance", async () => {
    const db = await linkedDb();
    const sent: Array<{ to: string; body: unknown }> = [];
    const fetchFn = router(sent);
    await handleInboundEvent(db, CONFIG, null, { type: "text", from: PHONE, text: "Bookshop now 10" }, { fetchFn, now: NOW });
    const proposal = (sent[0].body as ButtonBody).interactive;
    const no = proposal.action.buttons.find((b) => b.reply.title === "Cancel")!.reply.id;
    await handleInboundEvent(db, CONFIG, null, { type: "button", from: PHONE, id: no }, { fetchFn, now: NOW });
    expect(db.cards[0].balance_cents).toBe(2500);
    expect(JSON.stringify(sent[1].body)).toContain("Nothing changed");
  });

  it("refuses unknown, ambiguous, and below-zero updates", async () => {
    const db = await linkedDb();
    await createCard(db, USER, { retailer: "Bookshop Cafe", balance: "10.00" }, [], NOW);
    const sent: Array<{ to: string; body: unknown }> = [];
    const fetchFn = router(sent);
    await handleInboundEvent(db, CONFIG, null, { type: "text", from: PHONE, text: "spent 5 at Steam" }, { fetchFn, now: NOW });
    expect(JSON.stringify(sent[0].body)).toContain("No card on file matches");
    await handleInboundEvent(db, CONFIG, null, { type: "text", from: PHONE, text: "spent 5 at Book" }, { fetchFn, now: NOW });
    expect(JSON.stringify(sent[1].body)).toContain("More than one card matches");
    await handleInboundEvent(db, CONFIG, null, { type: "text", from: PHONE, text: "spent 50 at Bookshop Cafe" }, { fetchFn, now: NOW });
    expect(JSON.stringify(sent[2].body)).toContain("below zero");
    expect(db.cards.every((c) => c.balance_cents === 2500 || c.balance_cents === 1000)).toBe(true);
  });

  it("rejects stale proposals and balances that moved", async () => {
    const db = await linkedDb();
    const sent: Array<{ to: string; body: unknown }> = [];
    const fetchFn = router(sent);
    await handleInboundEvent(db, CONFIG, null, { type: "text", from: PHONE, text: "spent 5 at Bookshop" }, { fetchFn, now: NOW });
    const yes = ((sent[0].body as ButtonBody).interactive.action.buttons.find((b) => b.reply.title === "Confirm")!).reply.id;
    await updateCard(db, USER, db.cards[0].id, [], { balance: "30.00" }, NOW);
    await handleInboundEvent(db, CONFIG, null, { type: "button", from: PHONE, id: yes }, { fetchFn, now: NOW });
    expect(JSON.stringify(sent[1].body)).toContain("moved since");
    expect(db.cards[0].balance_cents).toBe(3000);
    await handleInboundEvent(db, CONFIG, null, { type: "button", from: PHONE, id: yes }, { fetchFn, now: NOW });
    expect(JSON.stringify(sent[2].body)).toContain("expired");
  });
});
