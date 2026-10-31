import { describe, expect, it } from "vitest";
import type { AiConfig } from "./ai";
import { expectAuthError, FakeDb } from "./fake-db";
import {
  confirmLinkCode,
  downloadMedia,
  fetchMediaUrl,
  generateLinkCode,
  handleInboundEvent,
  normalizePhone,
  parseWebhookEvents,
  sendQuickReplies,
  sendTextMessage,
  startLink,
  summarizeExtraction,
  verifyHandshake,
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
      META_AI_ENDPOINT: "https://model.test",
      META_AI_MODEL: "m",
      META_AI_API_KEY: "k",
    };
    const out = whatsappEnv(env);
    expect(out.config).toEqual({ token: "t", phoneId: "p" });
    expect(out.ai).not.toBeNull();
    expect(out.verifyToken).toBe("v");
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

describe("parseWebhookEvents", () => {
  const entry = (messages: unknown[]) => ({ entry: [{ changes: [{ value: { messages } }] }] });

  it("parses text, image, and button replies", () => {
    const events = parseWebhookEvents(
      entry([
        { from: PHONE, type: "text", text: { body: "LINK ABC123" } },
        { from: PHONE, type: "image", image: { id: "media-1" } },
        { from: PHONE, type: "interactive", interactive: { button_reply: { id: "wa:file:x" } } },
      ]),
    );
    expect(events).toEqual([
      { type: "text", from: PHONE, text: "LINK ABC123" },
      { type: "image", from: PHONE, mediaId: "media-1" },
      { type: "button", from: PHONE, id: "wa:file:x" },
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
    expect(await confirmLinkCode(db, "19998887777", row.code, NOW)).toBeNull();
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

  it("sends quick replies and surfaces failures", async () => {
    const bodies: unknown[] = [];
    const ok = (async (_url: URL | string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return jsonResponse({ ok: true });
    }) as typeof fetch;
    await sendQuickReplies(CONFIG, PHONE, "File it?", [{ id: "a", title: "File it" }], ok);
    expect(bodies[0]).toMatchObject({ type: "interactive" });
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

  it("reads a photo and files it on confirmation", async () => {
    const db = new FakeDb();
    const row = await startLink(db, USER, PHONE, NOW);
    await confirmLinkCode(db, PHONE, row.code, NOW);
    const sent: Array<{ to: string; body: unknown }> = [];
    const fetchFn = router(sent, { retailer: "Bookshop", balance: "25.00", expiry: "2027-01-01" });
    await handleInboundEvent(db, CONFIG, AI, { type: "image", from: PHONE, mediaId: "media-1" }, { fetchFn, now: NOW });
    const interactive = (sent[0].body as { interactive: { body: { text: string }; action: { buttons: Array<{ reply: { id: string } }> } } }).interactive;
    expect(interactive.body.text).toContain("Bookshop");
    const fileId = interactive.action.buttons[0].reply.id;
    expect(db.waPending).toHaveLength(1);
    await handleInboundEvent(db, CONFIG, AI, { type: "button", from: PHONE, id: fileId }, { fetchFn, now: NOW });
    expect(db.cards).toHaveLength(1);
    expect(db.cards[0].retailer).toBe("Bookshop");
    expect(db.waPending).toHaveLength(0);
    expect(JSON.stringify(sent[1].body)).toContain("Filed");
  });

  it("discards without filing and reports stale trays", async () => {
    const db = new FakeDb();
    const row = await startLink(db, USER, PHONE, NOW);
    await confirmLinkCode(db, PHONE, row.code, NOW);
    const sent: Array<{ to: string; body: unknown }> = [];
    const fetchFn = router(sent, { retailer: "Bookshop", balance: "25.00" });
    await handleInboundEvent(db, CONFIG, AI, { type: "image", from: PHONE, mediaId: "media-1" }, { fetchFn, now: NOW });
    const interactive = (sent[0].body as { interactive: { action: { buttons: Array<{ reply: { id: string } }> } } }).interactive;
    const discardId = interactive.action.buttons[1].reply.id;
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
