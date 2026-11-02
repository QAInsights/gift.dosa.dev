import { AuthError } from "./auth";
import { chatCompletionsUrl, type AiConfig } from "./ai";
import { containsWords, termsOf, type AskCard, type AskShelf } from "./ask";
import { daysUntil } from "./cards";
import { formatDate, formatMoney, type DateFormat } from "./format";

const MAX_ERRANDS = 300;
const MAX_LINES = 8;
const MAX_LINE_TEXT = 120;
const MAX_NOTE = 140;
const MAX_SUMMARY = 800;
const MAX_PROMPT_CARDS = 100;

export interface PlanLine {
  errand: string;
  cardId: string | null;
  note: string;
}

export interface PlannedLine {
  errand: string;
  card: AskCard | null;
  note: string;
}

export interface ErrandPlan {
  lines: PlannedLine[];
  summary: string;
}

const PLAN_SYSTEM =
  "You match the user's errands against the gift cards in the shelf JSON. " +
  'Reply with JSON only, no prose: {"lines": [{"errand": "<one errand in a few words>", "cardId": "<shelf card id>" | null, "note": "<why this card fits, or why none does>"}]}. ' +
  "One line per errand, at most 8 lines. Use null when no live card fits an errand. " +
  "Cite only ids that appear in the shelf. Never invent retailers, amounts, dates, or ids. " +
  "Never assign a memory, an expired card, or a zero-balance card. When several cards fit, prefer the one that expires first. " +
  "Keep every note under 140 characters. The shelf never contains card numbers or PINs.";

export function normalizeErrands(raw: unknown): string {
  if (typeof raw !== "string") throw new AuthError(400, "Say what you need first.");
  const errands = raw.replace(/\s+/g, " ").trim();
  if (errands.length === 0) throw new AuthError(400, "Say what you need first.");
  if (errands.length > MAX_ERRANDS) {
    throw new AuthError(400, `Keep the list under ${MAX_ERRANDS + 1} characters.`);
  }
  return errands;
}

export function buildPlanBody(model: string, errands: string, shelf: AskShelf, dateFormat: DateFormat = "MDY"): unknown {
  const view = {
    cards: shelf.cards.slice(0, MAX_PROMPT_CARDS),
    sealedCount: shelf.sealedCount,
    totalCards: shelf.cards.length,
  };
  const hint =
    dateFormat === "DMY" ? "Write dates like 5 Nov 2026." : dateFormat === "ISO" ? "Write dates like 2026-11-05." : "Write dates like Nov 5, 2026.";
  return {
    model,
    messages: [
      { role: "system", content: `${PLAN_SYSTEM} ${hint}` },
      { role: "user", content: `Shelf (JSON): ${JSON.stringify(view)}\nErrands: ${errands}` },
    ],
  };
}

function cleanLine(src: unknown, allowed: Set<string>): PlanLine | null {
  if (!src || typeof src !== "object" || Array.isArray(src)) return null;
  const row = src as Record<string, unknown>;
  if (typeof row.errand !== "string") return null;
  const errand = row.errand.replace(/\s+/g, " ").trim().slice(0, MAX_LINE_TEXT);
  if (errand.length === 0) return null;
  const cardId = typeof row.cardId === "string" && allowed.has(row.cardId) ? row.cardId : null;
  const note =
    typeof row.note === "string" ? row.note.replace(/\s+/g, " ").trim().slice(0, MAX_NOTE) : "";
  return { errand, cardId, note };
}

export function parsePlanContent(content: string, allowedIds: readonly string[]): PlanLine[] | null {
  const text = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
      raw = JSON.parse(text.slice(start, end + 1));
    } catch {
      return null;
    }
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const lines = (raw as Record<string, unknown>).lines;
  if (!Array.isArray(lines) || lines.length === 0) return null;
  const allowed = new Set(allowedIds);
  const out: PlanLine[] = [];
  for (const row of lines) {
    const line = cleanLine(row, allowed);
    if (line) out.push(line);
    if (out.length >= MAX_LINES) break;
  }
  return out.length > 0 ? out : null;
}

function rejectionReason(card: AskCard, today: string): string | null {
  if (card.balance_cents <= 0) return "That card is already spent.";
  if (card.is_memory) return "That card is a keepsake, never for spending.";
  if (card.expiry && daysUntil(card.expiry, today) < 0) return "That card already expired.";
  return null;
}

export function validatePlan(lines: PlanLine[], shelf: AskShelf, today: string): PlannedLine[] {
  const byId = new Map(shelf.cards.map((c) => [c.id, c]));
  const used = new Set<string>();
  return lines.map((line) => {
    const card = line.cardId ? (byId.get(line.cardId) ?? null) : null;
    if (!card) {
      return { errand: line.errand, card: null, note: line.note || "No live card fits this errand." };
    }
    if (used.has(card.id)) {
      return { errand: line.errand, card: null, note: `${card.retailer} is already covering an errand above.` };
    }
    const rejected = rejectionReason(card, today);
    if (rejected) return { errand: line.errand, card: null, note: rejected };
    used.add(card.id);
    return { errand: line.errand, card, note: line.note };
  });
}

function expiryBit(card: AskCard, today: string, dateFormat: DateFormat): string {
  if (!card.expiry) return "";
  const days = daysUntil(card.expiry, today);
  if (days === 0) return " (expires today)";
  if (days === 1) return " (expires tomorrow)";
  if (days <= 90) return ` (expires in ${days} days)`;
  return ` (expires ${formatDate(card.expiry, dateFormat)})`;
}

export function summarizePlan(lines: PlannedLine[], today: string, dateFormat: DateFormat = "MDY"): string {
  const covered = lines.filter((l) => l.card !== null);
  if (covered.length === 0) {
    return "Nothing on the shelf covers these errands. File a card for one of them first.";
  }
  const parts = covered.map(
    (l) => `${l.card!.retailer} ${formatMoney(l.card!.balance_cents, l.card!.currency)} for ${l.errand}${expiryBit(l.card!, today, dateFormat)}`,
  );
  const byCurrency = new Map<string, number>();
  for (const l of covered) {
    byCurrency.set(l.card!.currency, (byCurrency.get(l.card!.currency) ?? 0) + l.card!.balance_cents);
  }
  const total = [...byCurrency.entries()].map(([cur, cents]) => formatMoney(cents, cur)).join(" · ");
  const uncovered = lines.filter((l) => l.card === null).map((l) => l.errand);
  const tail = uncovered.length > 0 ? ` No live card fits: ${uncovered.join("; ")}.` : "";
  const summary =
    `${parts.join(", ")}. ${total} covered across ${covered.length} ${covered.length === 1 ? "errand" : "errands"}.${tail}`;
  return summary.slice(0, MAX_SUMMARY);
}

export function splitErrands(errands: string): string[] {
  const chunks = errands.split(/[;,\n]+/).map((c) => c.trim()).filter(Boolean);
  const pieces = chunks.length > 1 ? chunks : errands.split(/\s+and\s+/i).map((c) => c.trim()).filter(Boolean);
  const out = (pieces.length > 0 ? pieces : [errands.trim()]).filter(Boolean).slice(0, MAX_LINES);
  return out.length > 0 ? out : [errands.trim()];
}

function fold(word: string): string {
  return word.length > 3 && word.endsWith("s") ? word.slice(0, -1) : word;
}

function scoreCard(card: AskCard, words: string[]): number {
  const folded = words.map(fold);
  let best = 0;
  for (const term of termsOf(card)) {
    if (containsWords(words, term) || containsWords(folded, term.map(fold))) {
      best = Math.max(best, term.length);
    }
  }
  return best;
}

export function fallbackPlan(errands: string, shelf: AskShelf, today: string, dateFormat: DateFormat = "MDY"): ErrandPlan {
  if (shelf.cards.length === 0) {
    const answer =
      shelf.sealedCount > 0
        ? "Everything on file is sealed. Open a drawer, then plan again."
        : "No cards are filed yet. File a card and I can plan from the shelf.";
    return { lines: [], summary: answer };
  }
  const live = shelf.cards.filter(
    (c) => c.balance_cents > 0 && !c.is_memory && (!c.expiry || daysUntil(c.expiry, today) >= 0),
  );
  const used = new Set<string>();
  const lines: PlannedLine[] = splitErrands(errands).map((errand) => {
    const words = errand.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    const ranked = live
      .filter((c) => !used.has(c.id))
      .map((card) => ({ card, score: scoreCard(card, words) }))
      .filter((row) => row.score > 0)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        const da = a.card.expiry ? daysUntil(a.card.expiry, today) : Number.POSITIVE_INFINITY;
        const db = b.card.expiry ? daysUntil(b.card.expiry, today) : Number.POSITIVE_INFINITY;
        return da - db;
      });
    const pick = ranked[0]?.card ?? null;
    if (!pick) return { errand, card: null, note: "No live card fits this errand." };
    used.add(pick.id);
    return { errand, card: pick, note: "Best word match on the shelf." };
  });
  return { lines, summary: summarizePlan(lines, today, dateFormat) };
}

export async function planErrands(
  config: AiConfig | null,
  errands: string,
  shelf: AskShelf,
  today: string,
  fetchFn: typeof fetch = fetch,
  dateFormat: DateFormat = "MDY",
): Promise<ErrandPlan & { source: "model" | "shelf" }> {
  if (config) {
    try {
      const res = await fetchFn(chatCompletionsUrl(config.endpoint), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
        body: JSON.stringify(buildPlanBody(config.model, errands, shelf, dateFormat)),
        signal: typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(15000) : undefined,
      });
      if (res.ok) {
        const data = (await res.json().catch(() => null)) as {
          choices?: { message?: { content?: unknown } }[];
        } | null;
        const content = data?.choices?.[0]?.message?.content;
        if (typeof content === "string") {
          const parsed = parsePlanContent(content, shelf.cards.map((c) => c.id));
          if (parsed) {
            const lines = validatePlan(parsed, shelf, today);
            return { lines, summary: summarizePlan(lines, today, dateFormat), source: "model" };
          }
        }
      }
    } catch {}
  }
  return { ...fallbackPlan(errands, shelf, today, dateFormat), source: "shelf" };
}
