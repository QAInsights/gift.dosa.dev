import { AuthError } from "./auth";
import { chatCompletionsUrl, type AiConfig } from "./ai";
import { daysUntil, listCabinet, type CardState } from "./cards";
import { listDrawers, type Db } from "./db";
import { formatDate, formatMoney, type DateFormat } from "./format";

const MAX_QUESTION = 300;
const MAX_ANSWER = 800;
const MAX_CITATIONS = 5;
const MAX_PROMPT_CARDS = 100;

export interface AskCard {
  id: string;
  retailer: string;
  nickname: string | null;
  balance_cents: number;
  currency: string;
  expiry: string | null;
  drawer: string;
  occasion: string | null;
  tags: string[];
  is_memory: boolean;
  state: CardState;
}

export interface AskShelf {
  cards: AskCard[];
  sealedCount: number;
}

export interface AskAnswer {
  answer: string;
  cardIds: string[];
}

const ASK_SYSTEM =
  "You answer questions about the user's gift cards using only the shelf JSON in the user message. " +
  'Reply with JSON only, no prose: {"answer": "<one or two short sentences>", "cardIds": ["<shelf card id>"]}. ' +
  "Cite only ids that appear in the shelf, and only cards your answer actually relies on. " +
  "Never invent retailers, amounts, dates, or ids. Balances are in cents; speak in dollars. " +
  "Memories are keepsakes: never suggest spending them. " +
  "If the shelf cannot answer, say so plainly and cite nothing. The shelf never contains card numbers or PINs.";

export function normalizeQuestion(raw: unknown): string {
  if (typeof raw !== "string") throw new AuthError(400, "Ask a question first.");
  const question = raw.replace(/\s+/g, " ").trim();
  if (question.length === 0) throw new AuthError(400, "Ask a question first.");
  if (question.length > MAX_QUESTION) {
    throw new AuthError(400, `Keep the question under ${MAX_QUESTION + 1} characters.`);
  }
  return question;
}

export async function askContext(db: Db, userId: string, unlocked: string[], today: string): Promise<AskShelf> {
  const [{ cards, sealedCount }, { results: drawers }] = await Promise.all([
    listCabinet(db, userId, unlocked, {}, today),
    listDrawers(db, userId),
  ]);
  const names = new Map(drawers.map((d) => [d.id, d.name]));
  return {
    sealedCount,
    cards: cards.map((c) => ({
      id: c.id,
      retailer: c.retailer,
      nickname: c.nickname,
      balance_cents: c.balance_cents,
      currency: c.currency,
      expiry: c.expiry,
      drawer: c.drawer_id ? (names.get(c.drawer_id) ?? "Personal") : "Personal",
      occasion: c.occasion,
      tags: c.tags,
      is_memory: c.is_memory,
      state: c.state,
    })),
  };
}

const DATE_HINTS: Record<DateFormat, string> = {
  MDY: "Write dates like Nov 5, 2026.",
  DMY: "Write dates like 5 Nov 2026.",
  ISO: "Write dates like 2026-11-05.",
};

export function buildAskBody(model: string, question: string, shelf: AskShelf, dateFormat: DateFormat = "MDY"): unknown {
  const view = {
    cards: shelf.cards.slice(0, MAX_PROMPT_CARDS),
    sealedCount: shelf.sealedCount,
    totalCards: shelf.cards.length,
  };
  return {
    model,
    messages: [
      { role: "system", content: `${ASK_SYSTEM} ${DATE_HINTS[dateFormat]}` },
      { role: "user", content: `Shelf (JSON): ${JSON.stringify(view)}\nQuestion: ${question}` },
    ],
  };
}

export function answerConsistent(answer: string, shelf: AskShelf): boolean {
  const balances = new Set(shelf.cards.map((c) => c.balance_cents));
  for (const match of answer.matchAll(/\$\s?([\d,]+(?:\.\d{1,2})?)/g)) {
    const cents = Math.round(Number(match[1].replace(/,/g, "")) * 100);
    if (!balances.has(cents)) return false;
  }
  return true;
}

export function parseAskContent(content: string, allowedIds: readonly string[]): AskAnswer | null {
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
  const src = raw as Record<string, unknown>;
  if (typeof src.answer !== "string") return null;
  const answer = src.answer.replace(/\s+/g, " ").trim().slice(0, MAX_ANSWER);
  if (answer.length === 0) return null;
  const allowed = new Set(allowedIds);
  const cardIds: string[] = [];
  if (Array.isArray(src.cardIds)) {
    for (const id of src.cardIds) {
      if (typeof id === "string" && allowed.has(id) && !cardIds.includes(id)) cardIds.push(id);
      if (cardIds.length >= MAX_CITATIONS) break;
    }
  }
  return { answer, cardIds };
}

function spendPick(cards: AskCard[], today: string): AskCard | null {
  const candidates = cards.filter(
    (c) => c.balance_cents > 0 && !c.is_memory && (!c.expiry || daysUntil(c.expiry, today) >= 0),
  );
  candidates.sort((a, b) => {
    const da = a.expiry ? daysUntil(a.expiry, today) : Number.POSITIVE_INFINITY;
    const db = b.expiry ? daysUntil(b.expiry, today) : Number.POSITIVE_INFINITY;
    if (da !== db) return da - db;
    return b.balance_cents - a.balance_cents;
  });
  return candidates[0] ?? null;
}

function describe(card: AskCard, dateFormat: DateFormat): string {
  const money = formatMoney(card.balance_cents, card.currency);
  return card.expiry
    ? `${card.retailer}, ${money}, expires ${formatDate(card.expiry, dateFormat)}`
    : `${card.retailer}, ${money}, no expiry`;
}

function sealedNote(sealedCount: number): string {
  if (sealedCount === 0) return "";
  return ` ${sealedCount} ${sealedCount === 1 ? "card rests" : "cards rest"} in sealed drawers and ${sealedCount === 1 ? "is" : "are"} not counted.`;
}

function termsOf(card: AskCard): string[][] {
  const terms = new Map<string, string[]>();
  for (const value of [card.retailer, card.drawer, card.occasion ?? "", ...card.tags]) {
    const words = value.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    if (words.length > 0) terms.set(words.join(" "), words);
    for (const word of words) if (word.length >= 4) terms.set(word, [word]);
  }
  return [...terms.values()];
}

function containsWords(words: string[], term: string[]): boolean {
  if (term.length === 0 || term.length > words.length) return false;
  for (let i = 0; i + term.length <= words.length; i++) {
    if (term.every((word, j) => words[i + j] === word)) return true;
  }
  return false;
}

export function fallbackAnswer(question: string, shelf: AskShelf, today: string, dateFormat: DateFormat = "MDY"): AskAnswer {
  const q = question.toLowerCase();
  const cards = shelf.cards;
  if (cards.length === 0) {
    if (shelf.sealedCount > 0) {
      return {
        answer: `Everything on file is sealed. Open a drawer, then ask again.${sealedNote(shelf.sealedCount)}`,
        cardIds: [],
      };
    }
    return { answer: "No cards are filed yet. File a card and I can answer from the shelf.", cardIds: [] };
  }
  const live = cards.filter((c) => c.balance_cents > 0);

  if (q.includes("spend") || q.includes("which card should") || q.includes("use first") || q.includes("use next")) {
    const pick = spendPick(cards, today);
    if (!pick) {
      return { answer: `Nothing to spend right now. Every live card is a memory, expired, or already spent.${sealedNote(shelf.sealedCount)}`, cardIds: [] };
    }
    return { answer: `Spend ${describe(pick, dateFormat)} first.${sealedNote(shelf.sealedCount)}`, cardIds: [pick.id] };
  }

  if (q.includes("expir") || q.includes("due")) {
    const dated = live
      .filter((c) => c.expiry)
      .sort((a, b) => (a.expiry! < b.expiry! ? -1 : a.expiry! > b.expiry! ? 1 : 0));
    if (dated.length === 0) {
      return { answer: `No live card has an expiry date.${sealedNote(shelf.sealedCount)}`, cardIds: [] };
    }
    const [first, ...rest] = dated;
    if (daysUntil(first.expiry!, today) < 0) {
      return {
        answer: `${first.retailer}, ${formatMoney(first.balance_cents, first.currency)}, already expired ${formatDate(first.expiry!, dateFormat)}.${sealedNote(shelf.sealedCount)}`,
        cardIds: dated.slice(0, 3).map((c) => c.id),
      };
    }
    const more = rest.length > 0 ? ` ${rest.length} more ${rest.length === 1 ? "follows" : "follow"}.` : "";
    return {
      answer: `${describe(first, dateFormat)}. Soonest first.${more}${sealedNote(shelf.sealedCount)}`,
      cardIds: dated.slice(0, 3).map((c) => c.id),
    };
  }

  const words = q.split(/[^a-z0-9]+/).filter(Boolean);
  const matched = live.filter((card) => termsOf(card).some((term) => containsWords(words, term)));
  if (matched.length > 0) {
    if (q.includes("how many")) {
      const names = matched.slice(0, 3).map((c) => c.retailer).join(", ");
      return {
        answer: `${matched.length} live ${matched.length === 1 ? "card matches" : "cards match"}: ${names}.${sealedNote(shelf.sealedCount)}`,
        cardIds: matched.slice(0, MAX_CITATIONS).map((c) => c.id),
      };
    }
    const byCurrency = new Map<string, number>();
    for (const card of matched) byCurrency.set(card.currency, (byCurrency.get(card.currency) ?? 0) + card.balance_cents);
    const totals = [...byCurrency.entries()].map(([cur, cents]) => formatMoney(cents, cur)).join(" · ");
    const names = matched.slice(0, 3).map((c) => c.retailer).join(", ");
    return {
      answer: `${totals} across ${matched.length} live ${matched.length === 1 ? "card" : "cards"}: ${names}.${sealedNote(shelf.sealedCount)}`,
      cardIds: matched.slice(0, MAX_CITATIONS).map((c) => c.id),
    };
  }

  if (q.includes("how many") || q.includes("count")) {
    return {
      answer: `${cards.length} ${cards.length === 1 ? "card is" : "cards are"} on the shelf, ${live.length} with money left.${sealedNote(shelf.sealedCount)}`,
      cardIds: [],
    };
  }

  if (q.includes("how much") || q.includes("total") || q.includes("balance") || q.includes("worth") || q.includes("have")) {
    const byCurrency = new Map<string, number>();
    for (const card of live) byCurrency.set(card.currency, (byCurrency.get(card.currency) ?? 0) + card.balance_cents);
    const totals =
      byCurrency.size > 0 ? [...byCurrency.entries()].map(([cur, cents]) => formatMoney(cents, cur)).join(" · ") : formatMoney(0);
    const top = [...live].sort((a, b) => b.balance_cents - a.balance_cents).slice(0, MAX_CITATIONS);
    return {
      answer: `You have ${totals} across ${live.length} live ${live.length === 1 ? "card" : "cards"}.${sealedNote(shelf.sealedCount)}`,
      cardIds: top.map((c) => c.id),
    };
  }

  const pick = spendPick(cards, today);
  if (pick) {
    return {
      answer: `Start with ${describe(pick, dateFormat)}. Ask what expires first, or how much sits in a drawer.${sealedNote(shelf.sealedCount)}`,
      cardIds: [pick.id],
    };
  }
  return {
    answer: `Ask what expires first, how much you have, or what sits in a drawer.${sealedNote(shelf.sealedCount)}`,
    cardIds: [],
  };
}

export async function answerQuestion(
  config: AiConfig | null,
  question: string,
  shelf: AskShelf,
  today: string,
  fetchFn: typeof fetch = fetch,
  dateFormat: DateFormat = "MDY",
): Promise<AskAnswer & { source: "model" | "shelf" }> {
  if (config) {
    try {
      const res = await fetchFn(chatCompletionsUrl(config.endpoint), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
        body: JSON.stringify(buildAskBody(config.model, question, shelf, dateFormat)),
        signal: typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(15000) : undefined,
      });
      if (res.ok) {
        const data = (await res.json().catch(() => null)) as {
          choices?: { message?: { content?: unknown } }[];
        } | null;
        const content = data?.choices?.[0]?.message?.content;
        if (typeof content === "string") {
          const parsed = parseAskContent(content, shelf.cards.map((c) => c.id));
          if (parsed && answerConsistent(parsed.answer, shelf)) return { ...parsed, source: "model" };
        }
      }
    } catch {}
  }
  return { ...fallbackAnswer(question, shelf, today, dateFormat), source: "shelf" };
}
