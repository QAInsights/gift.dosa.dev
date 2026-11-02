import { AuthError } from "./auth";
import { chatCompletionsUrl, type AiConfig } from "./ai";
import { normalizeExpiry } from "./cards";

const MAX_TRANSCRIPT = 1000;
const MAX_RETAILER = 80;
const MAX_OCCASION = 40;
const MAX_NOTES = 500;

export interface VoiceDraft {
  retailer: string | null;
  amount: string | null;
  currency: string | null;
  currencyConfident: boolean;
  expiry: string | null;
  occasion: string | null;
  notes: string | null;
  drawerId: string | null;
  drawerName: string | null;
  transcript: string;
  needsReview: string[];
}

export interface VoiceContext {
  drawers: { id: string; name: string }[];
  defaultCurrency: string;
  today: string;
  timeZone: string;
}

const VOICE_SYSTEM =
  "You read a spoken gift-card filing request and reply with JSON only, no prose: " +
  '{"retailer": string | null, "amount": number | null, "currency": "<3-letter ISO code>" | null, ' +
  '"currencyWords": "<the exact currency words heard>" | null, "expiry": "<YYYY-MM-DD>" | null, ' +
  '"occasion": string | null, "giver": string | null, "drawer": "<drawer name as heard>" | null}. ' +
  "Rules: amount is the number exactly as heard, never converted. currency holds an ISO code only when the words name it unambiguously " +
  '("US dollars" is USD, "pounds" is GBP, "euros" is EUR, "rupees" is INR); a bare "dollars" means currency null with currencyWords "dollars". ' +
  "expiry holds a calendar date only when one is stated or clearly implied (resolve relative dates against the today and time zone given); " +
  "otherwise null, never invented. giver is a person's name only. drawer repeats the drawer name as heard, or null. " +
  "Retailer, occasion, and giver stay under 40 characters each. Never include card numbers or PINs; ignore them if spoken.";

const CONFIDENT_CURRENCY: [RegExp, string][] = [
  [/\b(us|u\.s\.|american)\s+dollars?\b/i, "USD"],
  [/\bcanadian\s+dollars?\b/i, "CAD"],
  [/\baustralian\s+dollars?\b/i, "AUD"],
  [/\bnew\s+zealand\s+dollars?\b/i, "NZD"],
  [/\bsingapore\s+dollars?\b/i, "SGD"],
  [/\bhong\s+kong\s+dollars?\b/i, "HKD"],
  [/\bpounds?(?:\s+sterling)?\b|\bsterling\b/i, "GBP"],
  [/\beuros?\b/i, "EUR"],
  [/\brupees?\b/i, "INR"],
  [/\b(usd|gbp|eur|inr|cad|aud|sgd|chf|aed|hkd|mxn|nzd)\b/i, ""],
];

function explicitCurrency(words: string): string | null {
  for (const [pattern, code] of CONFIDENT_CURRENCY) {
    const match = words.match(pattern);
    if (match) return code || match[1].toUpperCase();
  }
  return null;
}

export function normalizeTranscript(raw: unknown): string {
  if (typeof raw !== "string") throw new AuthError(400, "Say the card details first.");
  const transcript = raw.replace(/\s+/g, " ").trim();
  if (transcript.length === 0) throw new AuthError(400, "Say the card details first.");
  if (transcript.length > MAX_TRANSCRIPT) throw new AuthError(400, "That recording is too long. Say one card at a time.");
  return transcript;
}

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim().slice(0, max);
  return text.length > 0 ? text : null;
}

function cleanAmount(value: unknown): string | null {
  const num = typeof value === "number" ? value : typeof value === "string" ? Number(value.replace(/,/g, "")) : NaN;
  if (!Number.isFinite(num) || num <= 0 || num >= 10000000) return null;
  return num.toFixed(2);
}

function matchDrawer(heard: string | null, drawers: VoiceContext["drawers"]): { id: string | null; name: string | null } {
  if (!heard) return { id: null, name: null };
  const words = heard.toLowerCase();
  if (/\bpersonal\b/.test(words)) return { id: "", name: "Personal" };
  const hit = drawers.find((d) => {
    const name = d.name.toLowerCase();
    return name.length > 0 && (words.includes(name) || name.split(/\s+/).some((w) => w.length >= 4 && words.includes(w)));
  });
  return hit ? { id: hit.id, name: hit.name } : { id: null, name: null };
}

function cleanExpiry(value: unknown, today: string): { expiry: string | null; bad: boolean } {
  if (value === null || value === undefined || value === "") return { expiry: null, bad: false };
  if (typeof value !== "string") return { expiry: null, bad: true };
  try {
    return { expiry: normalizeExpiry(value.trim(), today), bad: false };
  } catch {
    return { expiry: null, bad: true };
  }
}

interface RawDraft {
  retailer?: unknown;
  amount?: unknown;
  currency?: unknown;
  currencyWords?: unknown;
  expiry?: unknown;
  occasion?: unknown;
  giver?: unknown;
  drawer?: unknown;
}

export function validateDraft(raw: RawDraft, transcript: string, ctx: VoiceContext): VoiceDraft {
  const needsReview: string[] = [];
  const retailer = cleanText(raw.retailer, MAX_RETAILER);
  if (!retailer) needsReview.push("retailer");
  const amount = cleanAmount(raw.amount);
  if (amount) needsReview.push("amount");
  const saidCurrency = typeof raw.currency === "string" && /^[A-Za-z]{3}$/.test(raw.currency.trim())
    ? raw.currency.trim().toUpperCase()
    : null;
  const currencyWords = typeof raw.currencyWords === "string" ? raw.currencyWords : "";
  let currency: string | null = null;
  let currencyConfident = false;
  if (saidCurrency) {
    if (currencyWords && !explicitCurrency(currencyWords) && /\bdollars?\b/i.test(currencyWords)) {
      currency = ctx.defaultCurrency;
      currencyConfident = false;
      needsReview.push("currency");
    } else {
      currency = saidCurrency;
      currencyConfident = true;
    }
  } else if (amount) {
    const explicit = explicitCurrency(currencyWords);
    if (explicit) {
      currency = explicit;
      currencyConfident = true;
    } else {
      currency = ctx.defaultCurrency;
      currencyConfident = false;
      needsReview.push("currency");
    }
  }
  const { expiry, bad } = cleanExpiry(raw.expiry, ctx.today);
  if (bad) needsReview.push("expiry");
  const occasion = cleanText(raw.occasion, MAX_OCCASION);
  const giver = cleanText(raw.giver, MAX_OCCASION);
  const notes = giver ? `From ${giver}.` : null;
  const heardDrawer = cleanText(raw.drawer, MAX_RETAILER);
  const { id: drawerId, name: drawerName } = matchDrawer(heardDrawer, ctx.drawers);
  if (heardDrawer && drawerId === null) needsReview.push("drawer");
  return {
    retailer,
    amount,
    currency,
    currencyConfident,
    expiry,
    occasion,
    notes: notes ? notes.slice(0, MAX_NOTES) : null,
    drawerId,
    drawerName,
    transcript,
    needsReview,
  };
}

export function parseVoiceContent(content: string): RawDraft | null {
  const text = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const candidates = [text];
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) candidates.push(text.slice(start, end + 1));
  for (const candidate of candidates) {
    try {
      const raw: unknown = JSON.parse(candidate);
      if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as RawDraft;
    } catch {}
  }
  return null;
}

export function buildVoiceBody(model: string, transcript: string, ctx: VoiceContext): unknown {
  return {
    model,
    messages: [
      { role: "system", content: VOICE_SYSTEM },
      {
        role: "user",
        content:
          `Today is ${ctx.today} (${ctx.timeZone}). ` +
          `Existing drawers: ${["Personal", ...ctx.drawers.map((d) => d.name)].join(", ") || "Personal"}. ` +
          `Transcript: ${transcript}`,
      },
    ],
  };
}

const ONES: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const NUMBER_WORD = "(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)";
const CURRENCY_WORD = "(?:dollars?|pounds?|sterling|euros?|rupees?|bucks?|usd|gbp|eur|inr|cad|aud)";

function wordAmount(transcript: string): string | null {
  if (/\b(?:a|one)\s+hundred\b/i.test(transcript)) {
    const h = transcript.match(new RegExp(`\\b(?:a|one)\\s+hundred\\s+${CURRENCY_WORD}`, "i"));
    if (h) return "100";
  }
  const match = transcript.match(new RegExp(`\\b${NUMBER_WORD}(?:[-\\s](?:one|two|three|four|five|six|seven|eight|nine))?\\s+${CURRENCY_WORD}`, "i"));
  if (!match) return null;
  const parts = match[0].replace(new RegExp(`\\s+${CURRENCY_WORD}$`, "i"), "").toLowerCase().split(/[-\s]+/);
  let total = 0;
  for (const part of parts) total += ONES[part] ?? TENS[part] ?? 0;
  return total > 0 ? String(total) : null;
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function resolveRelativeDay(words: string, today: string): string | null {
  const dayMs = 86400000;
  const base = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(base)) return null;
  if (/\btoday\b/i.test(words)) return today;
  if (/\btomorrow\b/i.test(words)) return new Date(base + dayMs).toISOString().slice(0, 10);
  const match = words.match(/\b(?:next|this|on)\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i);
  if (!match) return null;
  const target = WEEKDAYS.indexOf(match[1].toLowerCase());
  const current = new Date(base).getUTCDay();
  let delta = (target - current + 7) % 7;
  if (/^next\b/i.test(match[0]) && delta === 0) delta = 7;
  return new Date(base + delta * dayMs).toISOString().slice(0, 10);
}

function fallbackRaw(transcript: string, today: string): RawDraft {
  const amountMatch =
    transcript.match(/\$\s?([\d,]+(?:\.\d{1,2})?)/) ??
    transcript.match(/([\d,]+(?:\.\d{1,2})?)\s*(?:us|u\.s\.|canadian|australian)?\s*dollars?/i) ??
    transcript.match(/([\d,]+(?:\.\d{1,2})?)\s*(?:pounds?|sterling|euros?|rupees?|bucks?)/i);
  const currencyWordMatch = transcript.match(
    /((?:us|u\.s\.|american|canadian|australian|sterling)?\s*(?:dollars?|pounds?|euros?|rupees?|bucks?))/i,
  );
  const retailerMatch = transcript.match(/\b([A-Z][A-Za-z&]*(?:\s+[A-Z][A-Za-z&]*)?)\s+gift\s+cards?\b/);
  const giverMatch = transcript.match(/\bfrom\s+([A-Z][a-z]+)/);
  const occasionMatch = transcript.match(/\b(birthday|christmas|wedding|anniversary|graduation|holiday|thanksgiving)\b/i);
  const drawerMatch = transcript.match(/\bput\s+it\s+in\s+([A-Za-z][A-Za-z ]*?)(?:\.|$)/i) ?? transcript.match(/\bin\s+(personal)\b/i);
  const isoMatch = transcript.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  return {
    retailer: retailerMatch ? retailerMatch[1].trim() : null,
    amount: amountMatch ? amountMatch[1] : wordAmount(transcript),
    currency: null,
    currencyWords: currencyWordMatch ? currencyWordMatch[1].trim() : null,
    expiry: isoMatch ? isoMatch[1] : resolveRelativeDay(transcript, today),
    occasion: occasionMatch ? occasionMatch[1].slice(0, 1).toUpperCase() + occasionMatch[1].slice(1).toLowerCase() : null,
    giver: giverMatch ? giverMatch[1] : null,
    drawer: drawerMatch ? drawerMatch[1].trim() : null,
  };
}

export function fallbackDraft(transcript: string, ctx: VoiceContext): VoiceDraft {
  return validateDraft(fallbackRaw(transcript, ctx.today), transcript, ctx);
}

export async function extractVoiceDraft(
  config: AiConfig | null,
  transcript: string,
  ctx: VoiceContext,
  fetchFn: typeof fetch = fetch,
): Promise<VoiceDraft> {
  if (config) {
    try {
      const res = await fetchFn(chatCompletionsUrl(config.endpoint), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
        body: JSON.stringify(buildVoiceBody(config.model, transcript, ctx)),
        signal: typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(15000) : undefined,
      });
      if (res.ok) {
        const data = (await res.json().catch(() => null)) as {
          choices?: { message?: { content?: unknown } }[];
        } | null;
        const content = data?.choices?.[0]?.message?.content;
        if (typeof content === "string") {
          const parsed = parseVoiceContent(content);
          if (parsed) return validateDraft(parsed, transcript, ctx);
        }
      }
    } catch {}
  }
  return fallbackDraft(transcript, ctx);
}
