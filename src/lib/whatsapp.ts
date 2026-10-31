import { aiConfigFromEnv, extractCardFields, type AiConfig, type ExtractedFields } from "./ai";
import { AuthError } from "./auth";
import { createCard } from "./cards";
import {
  deleteWhatsappLink,
  findDrawer,
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
  const link = await findWhatsappLinkByPhone(db, phone);
  if (!link || typeof rawCode !== "string") return null;
  if (!(await cronSecretMatches(rawCode.trim().toUpperCase(), link.code))) return null;
  await verifyWhatsappLink(db, link.user_id, now);
  return link.user_id;
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

export interface InboundDeps {
  fetchFn?: typeof fetch;
  now?: number;
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
    if (!match) {
      await send("Send a photo of a gift card to file it, or send LINK followed by your code to connect this number.");
      return;
    }
    const userId = await confirmLinkCode(db, event.from, match[1], now);
    await send(
      userId
        ? "This number is linked to your cabinet. Send a card photo whenever you like."
        : "That code did not match. Check the code on your Account page and try again.",
    );
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
} {
  return {
    config: whatsappConfigFromEnv(env),
    ai: aiConfigFromEnv(env),
    verifyToken: env.WHATSAPP_VERIFY_TOKEN?.trim(),
  };
}
