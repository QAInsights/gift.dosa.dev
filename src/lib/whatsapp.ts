// Meta messaging rules reviewed Nov 2026 (official Cloud API docs: send-messages,
// pricing). Every message here is a reactive service message inside the 24-hour
// customer service window opened by the user's own message: no templates needed,
// 1000 free service messages per business number per month, then per-message
// SERVICE rates apply and delivery stops without a payment method on file.
// Proactive outreach is deliberately NOT implemented: outside the window Meta
// allows only pre-approved templates (Marketing, Utility, or Authentication),
// requires user opt-in, and bills every delivery. A future nudge feature needs an
// approved Utility template plus recorded opt-in before sending anything.
import { aiConfigFromEnv, extractCardFields, type AiConfig, type ExtractedFields } from "./ai";
import { answerQuestion, askContext, normalizeQuestion, type AskCard } from "./ask";
import { AuthError } from "./auth";
import { createCard, todayYmd, updateCard, visibleCard } from "./cards";
import {
  deleteWhatsappLink,
  findDrawer,
  findPendingWhatsappLinkByCode,
  findWhatsappLinkByPhone,
  insertWhatsappPending,
  listDrawers,
  takeWhatsappPending,
  upsertWhatsappLink,
  verifyWhatsappLink,
  type Db,
  type WhatsappLinkRow,
} from "./db";
import { cronSecretMatches } from "./nudges";
import { formatMoney } from "./format";
import { DEFAULT_PREFS, getPrefs } from "./prefs";
import { allowRequest } from "./throttle";

const GRAPH_VERSION = "v23.0";
const MAX_PHOTO_BYTES = 5_000_000;
const LINK_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export interface WhatsappConfig {
  token: string;
  phoneId: string;
}

export function whatsappConfigFromEnv(env: Record<string, string | undefined>): WhatsappConfig | null {
  const token = env.WHATSAPP_TOKEN?.trim();
  const phoneId = env.WHATSAPP_PHONE_ID?.trim();
  if (!token || !phoneId) return null;
  return { token, phoneId };
}

export function verifyHandshake(url: URL, verifyToken: string | undefined): string | null {
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  if (mode === "subscribe" && verifyToken && token === verifyToken && challenge) return challenge;
  return null;
}

export async function verifyWebhookSignature(
  rawBody: string,
  header: string | null,
  appSecret: string,
): Promise<boolean> {
  if (!header || !header.startsWith("sha256=")) return false;
  const expected = header.slice("sha256=".length).trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(expected)) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(appSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const actual = [...new Uint8Array(mac)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

export type WhatsappEvent =
  | { type: "text"; from: string; text: string }
  | { type: "image"; from: string; mediaId: string }
  | { type: "button"; from: string; id: string };

export function parseWebhookEvents(body: unknown): WhatsappEvent[] {
  if (!body || typeof body !== "object" || Array.isArray(body)) return [];
  const out: WhatsappEvent[] = [];
  const entries = (body as { entry?: unknown }).entry;
  if (!Array.isArray(entries)) return [];
  for (const entry of entries) {
    const changes = (entry as { changes?: unknown })?.changes;
    if (!Array.isArray(changes)) continue;
    for (const change of changes) {
      const value = (change as { value?: unknown })?.value as
        | { messages?: Array<Record<string, unknown>> }
        | undefined;
      if (!value || !Array.isArray(value.messages)) continue;
      for (const message of value.messages) {
        if (typeof message.from !== "string") continue;
        const from = normalizePhone(message.from);
        if (!from) continue;
        if (message.type === "text" && typeof (message.text as { body?: unknown } | undefined)?.body === "string") {
          out.push({ type: "text", from, text: (message.text as { body: string }).body });
        } else if (message.type === "image" && typeof (message.image as { id?: unknown } | undefined)?.id === "string") {
          out.push({ type: "image", from, mediaId: (message.image as { id: string }).id });
        } else if (message.type === "interactive") {
          const interactive = message.interactive as
            | { button_reply?: { id?: unknown }; list_reply?: { id?: unknown } }
            | undefined;
          const replyId = interactive?.button_reply?.id ?? interactive?.list_reply?.id;
          if (typeof replyId === "string") out.push({ type: "button", from, id: replyId });
        }
      }
    }
  }
  return out;
}

export function normalizePhone(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 15 ? digits : "";
}

export function generateLinkCode(random: (size: number) => Uint8Array = defaultRandom): string {
  const bytes = random(6);
  let code = "";
  for (const byte of bytes) code += LINK_CODE_ALPHABET[byte % LINK_CODE_ALPHABET.length];
  return code;
}

function defaultRandom(size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return bytes;
}

export async function startLink(
  db: Db,
  userId: string,
  rawPhone: unknown,
  now = Date.now(),
): Promise<WhatsappLinkRow> {
  const phone = normalizePhone(rawPhone);
  if (!phone) throw new AuthError(400, "Enter a valid phone number, digits only.");
  const taken = await findWhatsappLinkByPhone(db, phone);
  if (taken && taken.user_id !== userId) {
    if (taken.verified_at !== null) throw new AuthError(409, "That number is already linked to another cabinet.");
    await deleteWhatsappLink(db, taken.user_id);
  }
  const row: WhatsappLinkRow = { user_id: userId, phone, code: generateLinkCode(), verified_at: null, created_at: now };
  try {
    await upsertWhatsappLink(db, row);
  } catch {
    throw new AuthError(409, "That number is already linked to another cabinet.");
  }
  return row;
}

export async function confirmLinkCode(
  db: Db,
  phone: string,
  rawCode: unknown,
  now = Date.now(),
): Promise<string | null> {
  const code = typeof rawCode === "string" ? rawCode.trim().toUpperCase() : "";
  if (!/^[A-Z0-9]{4,12}$/.test(code)) return null;
  const link = await findWhatsappLinkByPhone(db, phone);
  if (link && (await cronSecretMatches(code, link.code))) {
    await verifyWhatsappLink(db, link.user_id, now);
    return link.user_id;
  }
  const pending = await findPendingWhatsappLinkByCode(db, code);
  if (!pending) return null;
  const bound = await findWhatsappLinkByPhone(db, phone);
  if (bound && bound.user_id !== pending.user_id && bound.verified_at !== null) return null;
  if (bound && bound.user_id !== pending.user_id) await deleteWhatsappLink(db, bound.user_id);
  try {
    await upsertWhatsappLink(db, { ...pending, phone, verified_at: now });
  } catch {
    const clash = await findWhatsappLinkByPhone(db, phone);
    if (clash?.verified_at !== null || !clash || clash.user_id === pending.user_id) return null;
    await deleteWhatsappLink(db, clash.user_id);
    await upsertWhatsappLink(db, { ...pending, phone, verified_at: now });
  }
  return pending.user_id;
}

export async function unlinkNumber(db: Db, userId: string): Promise<void> {
  await deleteWhatsappLink(db, userId);
}

function graphUrl(phoneId: string, path: string): string {
  return `https://graph.facebook.com/${GRAPH_VERSION}/${phoneId}${path}`;
}

function requestSignal(): AbortSignal | undefined {
  return typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(15000) : undefined;
}

async function graphFetch(
  config: WhatsappConfig,
  path: string,
  init: RequestInit,
  fetchFn: typeof fetch,
): Promise<Response> {
  const res = await fetchFn(graphUrl(config.phoneId, path), {
    ...init,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.token}`, ...(init.headers ?? {}) },
    signal: requestSignal(),
  });
  if (!res.ok) throw new Error(`WhatsApp request failed (${res.status}).`);
  return res;
}

export async function sendTextMessage(
  config: WhatsappConfig,
  to: string,
  body: string,
  fetchFn: typeof fetch = fetch,
): Promise<void> {
  await graphFetch(
    config,
    "/messages",
    {
      method: "POST",
      body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body } }),
    },
    fetchFn,
  );
}

export interface DrawerListRow {
  id: string;
  title: string;
  description?: string;
}

export async function sendListMessage(
  config: WhatsappConfig,
  to: string,
  body: string,
  buttonLabel: string,
  sections: Array<{ title: string; rows: DrawerListRow[] }>,
  fetchFn: typeof fetch = fetch,
): Promise<void> {
  await graphFetch(
    config,
    "/messages",
    {
      method: "POST",
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "interactive",
        interactive: {
          type: "list",
          body: { text: body },
          action: { button: buttonLabel, sections },
        },
      }),
    },
    fetchFn,
  );
}

export interface ButtonReply {
  id: string;
  title: string;
}

export async function sendButtonsMessage(
  config: WhatsappConfig,
  to: string,
  body: string,
  buttons: ButtonReply[],
  fetchFn: typeof fetch = fetch,
): Promise<void> {
  await graphFetch(
    config,
    "/messages",
    {
      method: "POST",
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "interactive",
        interactive: {
          type: "button",
          body: { text: body },
          action: { buttons: buttons.slice(0, 3).map((b) => ({ type: "reply", reply: { id: b.id, title: b.title } })) },
        },
      }),
    },
    fetchFn,
  );
}

export async function fetchMediaUrl(
  token: string,
  mediaId: string,
  fetchFn: typeof fetch = fetch,
): Promise<{ url: string; mimeType: string }> {
  const res = await fetchFn(`https://graph.facebook.com/${GRAPH_VERSION}/${mediaId}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: requestSignal(),
  });
  if (!res.ok) throw new Error("Could not fetch that photo.");
  const data = (await res.json().catch(() => ({}))) as { url?: unknown; mime_type?: unknown };
  if (typeof data.url !== "string" || typeof data.mime_type !== "string") {
    throw new Error("Could not fetch that photo.");
  }
  return { url: data.url, mimeType: data.mime_type };
}

export async function downloadMedia(
  token: string,
  url: string,
  fetchFn: typeof fetch = fetch,
): Promise<{ bytes: ArrayBuffer; contentType: string }> {
  const res = await fetchFn(url, { headers: { Authorization: `Bearer ${token}` }, signal: requestSignal() });
  if (!res.ok) throw new Error("Could not download that photo.");
  const contentType = res.headers.get("content-type") ?? "image/jpeg";
  if (!contentType.startsWith("image/")) throw new Error("That file is not a photo.");
  const size = Number(res.headers.get("content-length") ?? 0);
  if (size > MAX_PHOTO_BYTES) throw new Error("That photo is too large. Keep it under 5 MB.");
  const bytes = await res.arrayBuffer();
  if (bytes.byteLength > MAX_PHOTO_BYTES) throw new Error("That photo is too large. Keep it under 5 MB.");
  if (bytes.byteLength === 0) throw new Error("That photo arrived empty. Send it again.");
  return { bytes, contentType };
}

export function summarizeExtraction(fields: ExtractedFields): string | null {
  const parts: string[] = [];
  if (fields.retailer) parts.push(fields.retailer);
  if (fields.balance) parts.push(`$${fields.balance}`);
  if (fields.expiry) parts.push(`expires ${fields.expiry}`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

export interface BalanceIntent {
  op: "spend" | "set";
  cents: number;
  retailer: string;
}

function parseIntentCents(raw: string): number | null {
  const cleaned = raw.replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const cents = Math.round(Number(cleaned) * 100);
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
}

function cleanRetailer(raw: string): string {
  return raw.replace(/\s+/g, " ").replace(/[?!.,;:]+$/g, "").trim().slice(0, 60);
}

export function parseBalanceIntent(text: string): BalanceIntent | null {
  const input = text.replace(/\s+/g, " ").trim();
  const spend = input.match(/^(?:spent|used|paid|redeemed)\s+\$?([\d,]+(?:\.\d{1,2})?)\s+(?:at|on|from|with)?\s*(.+)$/i);
  if (spend) {
    const cents = parseIntentCents(spend[1]);
    const retailer = cleanRetailer(spend[2]);
    if (cents !== null && retailer.length > 0) return { op: "spend", cents, retailer };
    return null;
  }
  const setTo = input.match(/^set\s+(.+?)\s+to\s+\$?([\d,]+(?:\.\d{1,2})?)$/i);
  if (setTo) {
    const cents = parseIntentCents(setTo[2]);
    const retailer = cleanRetailer(setTo[1]);
    if (cents !== null && retailer.length > 0) return { op: "set", cents, retailer };
    return null;
  }
  const nowIs = input.match(/^(.+?)\s+(?:is\s+)?now\s+\$?([\d,]+(?:\.\d{1,2})?)$/i);
  if (nowIs) {
    const cents = parseIntentCents(nowIs[2]);
    const retailer = cleanRetailer(nowIs[1]);
    if (cents !== null && retailer.length > 0) return { op: "set", cents, retailer };
    return null;
  }
  return null;
}

export function matchRetailer(cards: AskCard[], raw: string): AskCard[] {
  const needle = raw.toLowerCase().trim();
  if (!needle) return [];
  const exact = cards.filter((c) => c.retailer.toLowerCase() === needle);
  if (exact.length > 0) return exact;
  const words = needle.split(/[^a-z0-9]+/).filter(Boolean);
  return cards.filter((c) => {
    const hay = c.retailer.toLowerCase();
    return hay.includes(needle) || (words.length > 0 && words.every((w) => hay.includes(w)));
  });
}

interface BalanceProposal {
  kind: "balance";
  cardId: string;
  before: number;
  after: number;
  currency: string;
}

function parseBalanceProposal(payload: string): BalanceProposal | null {
  let raw: unknown;
  try {
    raw = JSON.parse(payload);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  if (p.kind !== "balance" || typeof p.cardId !== "string") return null;
  if (typeof p.before !== "number" || typeof p.after !== "number" || typeof p.currency !== "string") return null;
  if (!Number.isSafeInteger(p.before) || !Number.isSafeInteger(p.after) || p.after < 0) return null;
  return { kind: "balance", cardId: p.cardId, before: p.before, after: p.after, currency: p.currency };
}

export interface InboundDeps {
  fetchFn?: typeof fetch;
  now?: number;
}

async function proposeBalanceUpdate(
  db: Db,
  config: WhatsappConfig,
  fetchFn: typeof fetch,
  userId: string,
  to: string,
  intent: BalanceIntent,
  now: number,
): Promise<void> {
  const shelf = await askContext(db, userId, [], todayYmd(now));
  const matches = matchRetailer(shelf.cards, intent.retailer);
  if (matches.length === 0) {
    await sendTextMessage(config, to, `No card on file matches "${intent.retailer}". Check the name and try again.`, fetchFn);
    return;
  }
  if (matches.length > 1) {
    const names = matches.slice(0, 3).map((c) => c.retailer).join(", ");
    await sendTextMessage(config, to, `More than one card matches: ${names}. Name one exactly.`, fetchFn);
    return;
  }
  const card = matches[0];
  const after = intent.op === "spend" ? card.balance_cents - intent.cents : intent.cents;
  if (after < 0) {
    await sendTextMessage(
      config,
      to,
      `${card.retailer} holds ${formatMoney(card.balance_cents, card.currency)}. That would take it below zero, so nothing changed.`,
      fetchFn,
    );
    return;
  }
  if (after === card.balance_cents) {
    await sendTextMessage(config, to, `${card.retailer} is already ${formatMoney(card.balance_cents, card.currency)}. Nothing changed.`, fetchFn);
    return;
  }
  const pending = {
    id: crypto.randomUUID(),
    user_id: userId,
    phone: to,
    payload: JSON.stringify({ kind: "balance", cardId: card.id, before: card.balance_cents, after, currency: card.currency }),
    created_at: now,
  };
  await insertWhatsappPending(db, pending);
  await sendButtonsMessage(
    config,
    to,
    `Set ${card.retailer} from ${formatMoney(card.balance_cents, card.currency)} to ${formatMoney(after, card.currency)}?`,
    [
      { id: `wa:balance:${pending.id}:yes`, title: "Confirm" },
      { id: `wa:balance:${pending.id}:no`, title: "Cancel" },
    ],
    fetchFn,
  );
}

async function confirmBalanceUpdate(
  db: Db,
  config: WhatsappConfig,
  fetchFn: typeof fetch,
  userId: string,
  to: string,
  pendingId: string,
  choice: string,
  now: number,
): Promise<void> {
  const pending = await takeWhatsappPending(db, pendingId, userId);
  if (!pending) {
    await sendTextMessage(config, to, "That proposal expired. State the spend again to make a new one.", fetchFn);
    return;
  }
  const proposal = parseBalanceProposal(pending.payload);
  if (!proposal || choice !== "yes") {
    await sendTextMessage(config, to, "Left it alone. Nothing changed.", fetchFn);
    return;
  }
  let current;
  try {
    current = await visibleCard(db, userId, proposal.cardId, [], todayYmd(now));
  } catch {
    await sendTextMessage(config, to, "That card is no longer on file. Nothing changed.", fetchFn);
    return;
  }
  if (current.balance_cents !== proposal.before) {
    await sendTextMessage(
      config,
      to,
      `${current.retailer} moved since: it now holds ${formatMoney(current.balance_cents, current.currency)}. State the spend again.`,
      fetchFn,
    );
    return;
  }
  try {
    const updated = await updateCard(db, userId, proposal.cardId, [], { balance: (proposal.after / 100).toFixed(2) }, now);
    await sendTextMessage(config, to, `Updated: ${updated.retailer} is now ${formatMoney(updated.balance_cents, updated.currency)}.`, fetchFn);
  } catch (error) {
    await sendTextMessage(config, to, error instanceof Error ? error.message : "I could not update that card.", fetchFn);
  }
}

export async function handleInboundEvent(
  db: Db,
  config: WhatsappConfig,
  ai: AiConfig | null,
  event: WhatsappEvent,
  deps: InboundDeps = {},
): Promise<void> {
  const fetchFn = deps.fetchFn ?? fetch;
  const now = deps.now ?? Date.now();
  const send = (body: string) => sendTextMessage(config, event.from, body, fetchFn);

  if (event.type === "text") {
    const match = event.text.trim().match(/^LINK\s+([A-Za-z0-9]{4,12})$/i);
    if (match) {
      const userId = await confirmLinkCode(db, event.from, match[1], now);
      await send(
        userId
          ? "This number is linked to your cabinet. Send a card photo to file it, ask what expires first, or say what you spent."
          : "That code did not match a cabinet waiting to link. On your Account page, tap Get linking code again and send the new code from this number.",
      );
      return;
    }
    const textLink = await findWhatsappLinkByPhone(db, event.from);
    if (!textLink || textLink.verified_at === null) {
      await send("Link this number first: open your cabinet's Account page, add your number, and send LINK followed by the code it shows.");
      return;
    }
    const intent = parseBalanceIntent(event.text);
    if (intent) {
      await proposeBalanceUpdate(db, config, fetchFn, textLink.user_id, event.from, intent, now);
      return;
    }
    if (!allowRequest(`wa-ask:${textLink.user_id}`, 10, 60_000, now)) {
      await send("Too many questions at once. Wait a moment, then ask again.");
      return;
    }
    try {
      const question = normalizeQuestion(event.text);
      const today = todayYmd(now);
      const shelf = await askContext(db, textLink.user_id, [], today);
      const prefs = await getPrefs(db, textLink.user_id).catch(() => ({ ...DEFAULT_PREFS }));
      const result = await answerQuestion(ai, question, shelf, today, fetchFn, prefs.dateFormat);
      await send(result.answer);
    } catch (error) {
      await send(
        error instanceof AuthError
          ? error.message
          : "I could not answer that. Ask what expires first, how much you have, or say what you spent.",
      );
    }
    return;
  }

  const link = await findWhatsappLinkByPhone(db, event.from);
  if (!link || link.verified_at === null) {
    await send("Link this number first: open your cabinet's Account page, add your number, and send LINK followed by the code it shows.");
    return;
  }

  if (event.type === "image") {
    if (!ai) {
      await send("Photo reading is not switched on yet. File the card from the web app instead.");
      return;
    }
    let fields: ExtractedFields;
    try {
      const media = await fetchMediaUrl(config.token, event.mediaId, fetchFn);
      const photo = await downloadMedia(config.token, media.url, fetchFn);
      fields = await extractCardFields(ai, photo.bytes, photo.contentType, fetchFn);
    } catch (error) {
      await send(error instanceof Error ? error.message : "I could not read that photo.");
      return;
    }
    const summary = summarizeExtraction(fields);
    if (!summary) {
      await send("I could not read that photo. Try a clearer shot, or file it from the web app.");
      return;
    }
    const pending = {
      id: crypto.randomUUID(),
      user_id: link.user_id,
      phone: event.from,
      payload: JSON.stringify(fields),
      created_at: now,
    };
    await insertWhatsappPending(db, pending);
    const { results: drawers } = await listDrawers(db, link.user_id);
    const open = drawers.filter((drawer) => !drawer.lock_hash);
    const shown = open.slice(0, 9);
    const rows: DrawerListRow[] = [
      { id: `wa:file:${pending.id}:-`, title: "Personal", description: "No drawer" },
      ...shown.map((drawer) => ({
        id: `wa:file:${pending.id}:${drawer.id}`,
        title: `${drawer.emoji ? `${drawer.emoji} ` : ""}${drawer.name}`.slice(0, 24),
      })),
    ];
    let prompt = `I read: ${summary}. Pick a drawer:`;
    if (open.length > shown.length) prompt += " (first 9 shown)";
    else if (open.length < drawers.length) prompt += " (sealed drawers hidden)";
    await sendListMessage(
      config,
      event.from,
      prompt,
      "Drawers",
      [
        { title: "Drawers", rows },
        { title: "Done", rows: [{ id: `wa:discard:${pending.id}`, title: "Discard", description: "Throw this photo away" }] },
      ],
      fetchFn,
    );
    return;
  }

  const balance = event.id.match(/^wa:balance:([0-9a-f-]{36}):(yes|no)$/);
  if (balance) {
    await confirmBalanceUpdate(db, config, fetchFn, link.user_id, event.from, balance[1], balance[2], now);
    return;
  }
  const file = event.id.match(/^wa:file:([0-9a-f-]{36})(?::([0-9a-f-]{36}|-))?$/);
  const discard = event.id.match(/^wa:discard:([0-9a-f-]{36})$/);
  if (!file && !discard) return;
  const pending = await takeWhatsappPending(db, (file ?? discard)![1], link.user_id);
  if (!pending) {
    await send("That card already left the tray. Send a fresh photo to start over.");
    return;
  }
  if (discard) {
    await send("Discarded. Nothing was filed.");
    return;
  }
  const drawerId = file![2] && file![2] !== "-" ? file![2] : null;
  const fields = JSON.parse(pending.payload) as ExtractedFields;
  let home = "Personal";
  try {
    const card = await createCard(
      db,
      link.user_id,
      {
        drawer_id: drawerId,
        retailer: fields.retailer ?? "Unknown store",
        balance: fields.balance ?? "0.00",
        expiry: fields.expiry,
        notes: "Filed from WhatsApp.",
      },
      [],
      now,
    );
    if (card.drawer_id) home = (await findDrawer(db, card.drawer_id, link.user_id))?.name ?? "its drawer";
  } catch (error) {
    await send(error instanceof Error ? error.message : "I could not file that card.");
    return;
  }
  await send(`Filed: ${summarizeExtraction(fields) ?? "your card"} is in ${home}.`);
}

export function whatsappEnv(env: Record<string, string | undefined>): {
  config: WhatsappConfig | null;
  ai: AiConfig | null;
  verifyToken: string | undefined;
  appSecret: string | undefined;
} {
  const appSecret = env.WHATSAPP_APP_SECRET?.trim();
  return {
    config: whatsappConfigFromEnv(env),
    ai: aiConfigFromEnv(env),
    verifyToken: env.WHATSAPP_VERIFY_TOKEN?.trim(),
    appSecret: appSecret ? appSecret : undefined,
  };
}
