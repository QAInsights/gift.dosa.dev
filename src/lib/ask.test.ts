import { describe, expect, it } from "vitest";
import type { AiConfig } from "./ai";
import {
  answerQuestion,
  askContext,
  buildAskBody,
  fallbackAnswer,
  normalizeQuestion,
  parseAskContent,
  type AskCard,
  type AskShelf,
} from "./ask";
import { createCard, updateCard } from "./cards";
import { createDrawer } from "./drawers";
import { FakeDb, expectAuthError } from "./fake-db";
import { randomToken } from "./auth";
import { setVault } from "./vault";

const NOW = 1_790_000_000_000;
const TODAY = "2026-10-30";
const USER = "u-ask";
const KEY = randomToken(32);
const CONFIG: AiConfig = { endpoint: "https://example.invalid/v1", model: "muse-test", apiKey: "k" };

async function seededShelf(): Promise<{ db: FakeDb; shelf: AskShelf; mart: string; keepsake: string }> {
  const db = new FakeDb();
  const food = await createDrawer(db, USER, "Food", null, NOW);
  const mart = await createCard(db, USER, { retailer: "Mart", balance: "12.00", expiry: "2026-11-05", drawer_id: food.id, tags: "food" }, [], NOW);
  await createCard(db, USER, { retailer: "Books", balance: "50.00", expiry: "2027-06-01" }, [], NOW);
  await createCard(db, USER, { retailer: "Cafe", balance: "0.00" });
  const keepsake = await createCard(db, USER, { retailer: "Keepsake", balance: "40.00", expiry: "2026-11-02" }, [], NOW);
  await updateCard(db, USER, keepsake.id, [], { is_memory: true });
  const shelf = await askContext(db, USER, [], TODAY);
  return { db, shelf, mart: mart.id, keepsake: keepsake.id };
}

describe("normalizeQuestion", () => {
  it("trims and collapses whitespace", () => {
    expect(normalizeQuestion("  what   expires\nfirst? ")).toBe("what expires first?");
  });

  it("rejects empty, non-string, and oversized questions", async () => {
    await expectAuthError((async () => normalizeQuestion("   "))(), 400);
    await expectAuthError((async () => normalizeQuestion(42))(), 400);
    await expectAuthError((async () => normalizeQuestion("x".repeat(301)))(), 400);
  });
});

describe("askContext", () => {
  it("carries only shelf-safe fields — never vault secrets or last4", async () => {
    const db = new FakeDb();
    const card = await createCard(db, USER, { retailer: "Mart", balance: "12.00", last4: "4402" });
    card.vault_number = "4111222233334402";
    card.vault_pin = "9021";
    const shelf = await askContext(db, USER, [], TODAY);
    const json = JSON.stringify(shelf);
    expect(json).not.toContain("4111222233334402");
    expect(json).not.toContain("9021");
    expect(json).not.toContain("4402");
    expect(shelf.cards[0]).not.toHaveProperty("last4");
    expect(shelf.cards[0].drawer).toBe("Personal");
  });

  it("hides sealed cards and counts them without naming them", async () => {
    const db = new FakeDb();
    const sealed = await createDrawer(db, USER, "Gifts", "drawer-secret", NOW);
    await createCard(db, USER, { retailer: "Secret Shop", balance: "99.00", drawer_id: sealed.id }, [sealed.id]);
    await createCard(db, USER, { retailer: "Open Mart", balance: "1.00" });
    const shelf = await askContext(db, USER, [], TODAY);
    expect(shelf.cards.map((c) => c.retailer)).toEqual(["Open Mart"]);
    expect(shelf.sealedCount).toBe(1);
    expect(JSON.stringify(shelf)).not.toContain("Secret Shop");
    const open = await askContext(db, USER, [sealed.id], TODAY);
    expect(open.cards).toHaveLength(2);
    expect(open.sealedCount).toBe(0);
  });
});

describe("buildAskBody", () => {
  it("grounds the model in the shelf and asks for cited JSON", async () => {
    const { shelf, mart } = await seededShelf();
    const body = JSON.stringify(buildAskBody("muse-test", "What expires first?", shelf));
    expect(body).toContain("Mart");
    expect(body).toContain(mart);
    expect(body).toContain("cardIds");
    expect(body).not.toContain("vault");
  });
});

describe("parseAskContent", () => {
  it("keeps cited ids that exist and drops invented ones", async () => {
    const { mart, keepsake } = await seededShelf();
    const allowed = [mart, keepsake];
    expect(parseAskContent('{"answer":"Mart goes first.","cardIds":["' + mart + '","bogus","' + mart + '"]}', allowed)).toEqual({
      answer: "Mart goes first.",
      cardIds: [mart],
    });
    expect(parseAskContent('```json\n{"answer":"Books.","cardIds":["' + keepsake + '"]}\n```', allowed)?.cardIds).toEqual([keepsake]);
  });

  it("returns null for prose, empty answers, and non-objects", () => {
    expect(parseAskContent("Mart goes first.", ["a"])).toBeNull();
    expect(parseAskContent('{"answer":"  ","cardIds":[]}', ["a"])).toBeNull();
    expect(parseAskContent('["Mart"]', ["a"])).toBeNull();
    expect(parseAskContent("not json", ["a"])).toBeNull();
  });
});

describe("fallbackAnswer", () => {
  it("spends the soonest-expiring live card, memories excluded", async () => {
    const { shelf, mart } = await seededShelf();
    const out = fallbackAnswer("What should I spend first?", shelf, TODAY);
    expect(out.answer).toContain("Mart");
    expect(out.cardIds).toEqual([mart]);
  });

  it("answers expiry across all live cards, memories included", async () => {
    const { shelf, keepsake } = await seededShelf();
    const out = fallbackAnswer("What expires first?", shelf, TODAY);
    expect(out.answer).toContain("Keepsake");
    expect(out.cardIds[0]).toBe(keepsake);
  });

  it("totals live balances per currency and matches drawers by name", async () => {
    const { shelf, mart } = await seededShelf();
    const total = fallbackAnswer("How much do I have?", shelf, TODAY);
    expect(total.answer).toContain("$102.00");
    expect(total.answer).toContain("3");
    const food = fallbackAnswer("How much sits in Food?", shelf, TODAY);
    expect(food.answer).toContain("$12.00");
    expect(food.cardIds).toEqual([mart]);
  });

  it("handles an empty shelf and names sealed counts without naming cards", async () => {
    const empty = fallbackAnswer("What expires first?", { cards: [], sealedCount: 0 }, TODAY);
    expect(empty.answer).toContain("No cards");
    expect(empty.cardIds).toEqual([]);
    const sealed = fallbackAnswer("How much do I have?", { cards: [], sealedCount: 2 }, TODAY);
    expect(sealed.answer).toContain("sealed");
    expect(sealed.answer).not.toContain("Secret");
  });
});

describe("answerQuestion", () => {
  function fakeFetch(status: number, body: unknown): typeof fetch {
    return async () => new Response(JSON.stringify(body), { status });
  }

  it("uses the model answer with filtered citations when the model replies", async () => {
    const { shelf, mart } = await seededShelf();
    const fetchFn = fakeFetch(200, {
      choices: [{ message: { content: `{"answer":"Spend Mart first.","cardIds":["${mart}","invented"]}` } }],
    });
    const out = await answerQuestion(CONFIG, "What should I spend first?", shelf, TODAY, fetchFn);
    expect(out).toEqual({ answer: "Spend Mart first.", cardIds: [mart], source: "model" });
  });

  it("falls back to the shelf when the provider fails or garbles", async () => {
    const { shelf, mart } = await seededShelf();
    const down = await answerQuestion(CONFIG, "What should I spend first?", shelf, TODAY, fakeFetch(500, {}));
    expect(down.source).toBe("shelf");
    expect(down.cardIds).toEqual([mart]);
    const garbled = await answerQuestion(
      CONFIG,
      "What should I spend first?",
      shelf,
      TODAY,
      fakeFetch(200, { choices: [{ message: { content: "Mart, probably." } }] }),
    );
    expect(garbled.source).toBe("shelf");
    expect(garbled.answer).toContain("Mart");
  });

  it("never calls the model when AI is not configured", async () => {
    const { shelf, mart } = await seededShelf();
    let called = false;
    const fetchFn: typeof fetch = async () => {
      called = true;
      throw new Error("must not be called");
    };
    const out = await answerQuestion(null, "What should I spend first?", shelf, TODAY, fetchFn);
    expect(called).toBe(false);
    expect(out.source).toBe("shelf");
    expect(out.cardIds).toEqual([mart]);
  });

  it("keeps vault secrets out of the model request even for unlocked sealed cards", async () => {
    const db = new FakeDb();
    const sealed = await createDrawer(db, USER, "Gifts", "drawer-secret", NOW);
    const card = await createCard(db, USER, { retailer: "Secret Shop", balance: "9.00", drawer_id: sealed.id }, [sealed.id]);
    await setVault(db, USER, card.id, [sealed.id], { number: "4111222233334402", pin: "9021" }, KEY);
    const shelf = await askContext(db, USER, [sealed.id], TODAY);
    let seenBody = "";
    const fetchFn: typeof fetch = async (_input, init) => {
      seenBody = String(init?.body ?? "");
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"answer":"One card.","cardIds":[]}' } }] }), { status: 200 });
    };
    await answerQuestion(CONFIG, "How much do I have?", shelf, TODAY, fetchFn);
    expect(seenBody).not.toContain("4111222233334402");
    expect(seenBody).not.toContain("9021");
  });

  it("falls back when the model invents an amount and sends an abort signal", async () => {
    const { shelf, mart } = await seededShelf();
    let seenSignal: unknown;
    const inventing: typeof fetch = async (_input, init) => {
      seenSignal = init?.signal;
      return new Response(
        JSON.stringify({ choices: [{ message: { content: `{"answer":"You have $5000 at Target.","cardIds":["${mart}"]}` } }] }),
        { status: 200 },
      );
    };
    const out = await answerQuestion(CONFIG, "How much do I have?", shelf, TODAY, inventing);
    expect(out.source).toBe("shelf");
    expect(seenSignal).toBeInstanceOf(AbortSignal);
  });
});

describe("fallbackAnswer intent fixes", () => {
  const card = (patch: Partial<AskCard>): AskCard => ({
    id: "x",
    retailer: "Shop",
    nickname: null,
    balance_cents: 1000,
    currency: "USD",
    expiry: null,
    drawer: "Personal",
    occasion: null,
    tags: [],
    is_memory: false,
    state: "filed",
    ...patch,
  });

  it("answers which-card-expires with the soonest expiry, memories included", () => {
    const shelf: AskShelf = {
      sealedCount: 0,
      cards: [
        card({ id: "mart", retailer: "Mart", balance_cents: 1200, expiry: "2026-11-05" }),
        card({ id: "keep", retailer: "Keepsake", balance_cents: 4000, expiry: "2026-11-02", is_memory: true }),
      ],
    };
    expect(fallbackAnswer("Which card expires first?", shelf, TODAY).cardIds[0]).toBe("keep");
  });

  it("never spends an expired card and flags expired cards in expiry answers", () => {
    const shelf: AskShelf = {
      sealedCount: 0,
      cards: [
        card({ id: "old", retailer: "OldShop", balance_cents: 900, expiry: "2020-01-01" }),
        card({ id: "fresh", retailer: "Fresh", balance_cents: 500, expiry: "2027-01-01" }),
      ],
    };
    expect(fallbackAnswer("What should I spend first?", shelf, TODAY).cardIds).toEqual(["fresh"]);
    expect(fallbackAnswer("What expires first?", shelf, TODAY).answer).toContain("already expired");
  });

  it("scopes totals and counts to the named shop, partial names included", () => {
    const shelf: AskShelf = {
      sealedCount: 0,
      cards: [
        card({ id: "mart", retailer: "Mart", balance_cents: 1200 }),
        card({ id: "target", retailer: "Target Store", balance_cents: 2500 }),
        card({ id: "books", retailer: "Books", balance_cents: 5000 }),
      ],
    };
    expect(fallbackAnswer("How much do I have at Mart?", shelf, TODAY).answer).toContain("$12.00");
    expect(fallbackAnswer("How much is at Target?", shelf, TODAY).answer).toContain("$25.00");
    expect(fallbackAnswer("How many Mart cards do I have?", shelf, TODAY).cardIds).toEqual(["mart"]);
    expect(fallbackAnswer("How much is on my Smart card?", shelf, TODAY).answer).not.toContain("$12.00");
  });
});
