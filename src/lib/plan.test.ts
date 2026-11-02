import { describe, expect, it } from "vitest";
import type { AiConfig } from "./ai";
import type { AskCard, AskShelf } from "./ask";
import { expectAuthError } from "./fake-db";
import {
  fallbackPlan,
  normalizeErrands,
  parsePlanContent,
  planErrands,
  splitErrands,
  summarizePlan,
  validatePlan,
} from "./plan";

const TODAY = "2026-10-30";
const CONFIG: AiConfig = { endpoint: "https://example.invalid/v1", model: "muse-test", apiKey: "k" };

function card(overrides: Partial<AskCard> & { id: string; retailer: string }): AskCard {
  return {
    nickname: null,
    balance_cents: 1000,
    currency: "USD",
    expiry: null,
    drawer: "Personal",
    occasion: null,
    tags: [],
    is_memory: false,
    state: "filed",
    ...overrides,
  };
}

const SHELF: AskShelf = {
  sealedCount: 0,
  cards: [
    card({ id: "whole", retailer: "Whole Foods", balance_cents: 4218, tags: ["groceries"] }),
    card({ id: "book", retailer: "Bookshop", balance_cents: 2500, expiry: "2027-01-13", tags: ["books", "gifts"] }),
    card({ id: "sbux", retailer: "Starbucks", balance_cents: 735, tags: ["coffee"] }),
    card({ id: "old", retailer: "Old Mart", balance_cents: 500, expiry: "2026-01-01" }),
    card({ id: "keep", retailer: "Keepsake", balance_cents: 5000, is_memory: true }),
    card({ id: "spent", retailer: "Spent Shop", balance_cents: 0 }),
  ],
};

describe("normalizeErrands", () => {
  it("trims and caps the list", () => {
    expect(normalizeErrands("  groceries,  coffee ")).toBe("groceries, coffee");
  });

  it("rejects empty and oversized input", async () => {
    await expectAuthError((async () => normalizeErrands("  "))(), 400);
    await expectAuthError((async () => normalizeErrands("x".repeat(301)))(), 400);
  });
});

describe("splitErrands", () => {
  it("splits on commas and on a lone and", () => {
    expect(splitErrands("groceries, coffee")).toEqual(["groceries", "coffee"]);
    expect(splitErrands("groceries and coffee")).toEqual(["groceries", "coffee"]);
    expect(splitErrands("a birthday gift for Maya")).toEqual(["a birthday gift for Maya"]);
  });

  it("caps the line count", () => {
    expect(splitErrands("a,b,c,d,e,f,g,h,i,j")).toHaveLength(8);
  });
});

describe("parsePlanContent", () => {
  const ids = SHELF.cards.map((c) => c.id);

  it("keeps honest lines and nulls unknown ids", () => {
    const parsed = parsePlanContent(
      JSON.stringify({
        lines: [
          { errand: "groceries", cardId: "whole", note: "Covers food runs." },
          { errand: "mystery", cardId: "invented", note: "Nope." },
        ],
      }),
      ids,
    );
    expect(parsed).toEqual([
      { errand: "groceries", cardId: "whole", note: "Covers food runs." },
      { errand: "mystery", cardId: null, note: "Nope." },
    ]);
  });

  it("returns null for prose, empty lines, and non-objects", () => {
    expect(parsePlanContent("Whole Foods, probably.", ids)).toBeNull();
    expect(parsePlanContent(JSON.stringify({ lines: [] }), ids)).toBeNull();
    expect(parsePlanContent(JSON.stringify({ lines: [{ nope: 1 }] }), ids)).toBeNull();
    expect(parsePlanContent("not json", ids)).toBeNull();
  });

  it("caps lines and trims long text", () => {
    const lines = Array.from({ length: 12 }, (_, i) => ({ errand: `errand ${i}`, cardId: null, note: "x".repeat(500) }));
    const parsed = parsePlanContent(JSON.stringify({ lines }), ids);
    expect(parsed).toHaveLength(8);
    expect(parsed![0].note).toHaveLength(140);
  });
});

describe("validatePlan", () => {
  it("rejects spent, memory, expired, and double-booked cards", () => {
    const lines = validatePlan(
      [
        { errand: "a", cardId: "spent", note: "" },
        { errand: "b", cardId: "keep", note: "" },
        { errand: "c", cardId: "old", note: "" },
        { errand: "d", cardId: "whole", note: "" },
        { errand: "e", cardId: "whole", note: "" },
      ],
      SHELF,
      TODAY,
    );
    expect(lines.map((l) => l.card?.id ?? null)).toEqual([null, null, null, "whole", null]);
    expect(lines[0].note).toContain("spent");
    expect(lines[1].note).toContain("keepsake");
    expect(lines[2].note).toContain("expired");
    expect(lines[4].note).toContain("already");
  });

  it("keeps honest null lines with a default note", () => {
    const [line] = validatePlan([{ errand: "yacht", cardId: null, note: "" }], SHELF, TODAY);
    expect(line.card).toBeNull();
    expect(line.note).toContain("No live card");
  });
});

describe("summarizePlan", () => {
  it("names each cover with verified money and expiry", () => {
    const summary = summarizePlan(
      validatePlan(
        [
          { errand: "groceries", cardId: "whole", note: "" },
          { errand: "a gift for Maya", cardId: "book", note: "" },
        ],
        SHELF,
        TODAY,
      ),
      TODAY,
    );
    expect(summary).toContain("Whole Foods $42.18 for groceries");
    expect(summary).toContain("Bookshop $25.00 for a gift for Maya (expires in 75 days)");
    expect(summary).toContain("$67.18 covered across 2 errands");
  });

  it("names uncovered errands and empty shelves", () => {
    const summary = summarizePlan(
      validatePlan(
        [
          { errand: "coffee", cardId: "sbux", note: "" },
          { errand: "yacht", cardId: null, note: "" },
        ],
        SHELF,
        TODAY,
      ),
      TODAY,
    );
    expect(summary).toContain("No live card fits: yacht.");
    expect(summarizePlan([], TODAY)).toContain("Nothing on the shelf");
  });
});

describe("fallbackPlan", () => {
  it("matches errands by words and prefers the soonest expiry", () => {
    const out = fallbackPlan("groceries, a gift for Maya, coffee", SHELF, TODAY);
    expect(out.lines.map((l) => l.card?.id ?? null)).toEqual(["whole", "book", "sbux"]);
    expect(out.summary).toContain("$74.53 covered across 3 errands");
  });

  it("leaves unmatched errands uncovered", () => {
    const out = fallbackPlan("yacht", SHELF, TODAY);
    expect(out.lines[0].card).toBeNull();
    expect(out.summary).toContain("Nothing on the shelf");
  });

  it("handles empty and sealed shelves", () => {
    expect(fallbackPlan("coffee", { cards: [], sealedCount: 0 }, TODAY).summary).toContain("No cards");
    expect(fallbackPlan("coffee", { cards: [], sealedCount: 2 }, TODAY).summary).toContain("sealed");
  });
});

describe("planErrands", () => {
  function fakeFetch(status: number, body: unknown): typeof fetch {
    return async () => new Response(JSON.stringify(body), { status });
  }

  it("validates the model plan and recomputes the summary itself", async () => {
    const fetchFn = fakeFetch(200, {
      choices: [
        {
          message: {
            content: JSON.stringify({
              lines: [
                { errand: "groceries", cardId: "whole", note: "Food card." },
                { errand: "books", cardId: "invented", note: "Lies." },
              ],
            }),
          },
        },
      ],
    });
    const out = await planErrands(CONFIG, "groceries, books", SHELF, TODAY, fetchFn);
    expect(out.source).toBe("model");
    expect(out.lines.map((l) => l.card?.id ?? null)).toEqual(["whole", null]);
    expect(out.summary).toContain("Whole Foods $42.18");
    expect(out.summary).not.toContain("Lies");
  });

  it("falls back when the model fails or garbles", async () => {
    const down = await planErrands(CONFIG, "coffee", SHELF, TODAY, fakeFetch(500, {}));
    expect(down.source).toBe("shelf");
    expect(down.lines[0].card?.id).toBe("sbux");
    const garbled = await planErrands(
      CONFIG,
      "coffee",
      SHELF,
      TODAY,
      fakeFetch(200, { choices: [{ message: { content: "Starbucks, probably." } }] }),
    );
    expect(garbled.source).toBe("shelf");
    const missing = await planErrands(CONFIG, "coffee", SHELF, TODAY, async () => {
      throw new Error("offline");
    });
    expect(missing.source).toBe("shelf");
  });

  it("never sends vault secrets to the model", async () => {
    let seenBody = "";
    const fetchFn: typeof fetch = async (_input, init) => {
      seenBody = String(init?.body ?? "");
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"lines":[]}' } }] }), { status: 200 });
    };
    await planErrands(CONFIG, "coffee", SHELF, TODAY, fetchFn);
    expect(seenBody).not.toContain("vault");
    expect(seenBody).not.toContain("4111");
  });
});
