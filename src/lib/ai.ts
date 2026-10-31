import { AuthError } from "./auth";
import { normalizeExpiry, normalizeRetailer, parseBalance } from "./cards";

export interface AiConfig {
  endpoint: string;
  model: string;
  apiKey: string;
}

export interface ExtractedFields {
  retailer?: string;
  balance?: string;
  expiry?: string;
}

const EXTRACT_PROMPT =
  "You read gift card photos. Reply with JSON only, no prose: " +
  '{"retailer": "<store name>", "balance": "<amount like 25.00>", "expiry": "<YYYY-MM-DD>"}. ' +
  "Include only fields you can actually read; use null for the rest. Never include card numbers, PINs, or barcodes.";

export function aiConfigFromEnv(env: Record<string, string | undefined>): AiConfig | null {
  const endpoint = env.META_AI_ENDPOINT?.trim();
  const model = env.META_AI_MODEL?.trim();
  const apiKey = env.META_AI_API_KEY?.trim();
  if (!endpoint || !model || !apiKey) return null;
  return { endpoint, model, apiKey };
}

export function chatCompletionsUrl(endpoint: string): string {
  const base = endpoint.replace(/\/+$/, "");
  return base.endsWith("/chat/completions") ? base : `${base}/chat/completions`;
}

export function cleanExtraction(raw: unknown): ExtractedFields {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const src = raw as Record<string, unknown>;
  const out: ExtractedFields = {};
  try {
    if (src.retailer != null) out.retailer = normalizeRetailer(src.retailer);
  } catch {}
  try {
    if (src.balance != null) {
      const cents = parseBalance(typeof src.balance === "number" ? String(src.balance) : src.balance);
      out.balance = (cents / 100).toFixed(2);
    }
  } catch {}
  try {
    if (src.expiry != null) out.expiry = normalizeExpiry(src.expiry) ?? undefined;
  } catch {}
  return out;
}

export function parseExtractionContent(content: string): ExtractedFields {
  const text = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return cleanExtraction(JSON.parse(text));
  } catch {
    return {};
  }
}

function toBase64(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < view.length; i += CHUNK) {
    bin += String.fromCharCode(...view.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

export function buildExtractBody(model: string, bytes: ArrayBuffer, contentType: string): unknown {
  return {
    model,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: EXTRACT_PROMPT },
          { type: "image_url", image_url: { url: `data:${contentType};base64,${toBase64(bytes)}` } },
        ],
      },
    ],
  };
}

export async function extractCardFields(
  config: AiConfig,
  bytes: ArrayBuffer,
  contentType: string,
  fetchFn: typeof fetch = fetch,
): Promise<ExtractedFields> {
  let res: Response;
  try {
    res = await fetchFn(chatCompletionsUrl(config.endpoint), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify(buildExtractBody(config.model, bytes, contentType)),
    });
  } catch {
    throw new AuthError(502, "The photo could not be read. Type the card instead.");
  }
  if (!res.ok) throw new AuthError(502, "The photo could not be read. Type the card instead.");
  const data = (await res.json().catch(() => null)) as {
    choices?: { message?: { content?: unknown } }[];
  } | null;
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new AuthError(502, "The photo could not be read. Type the card instead.");
  const fields = parseExtractionContent(content);
  if (Object.keys(fields).length === 0) {
    throw new AuthError(422, "Nothing readable on that photo. Type the card instead.");
  }
  return fields;
}
