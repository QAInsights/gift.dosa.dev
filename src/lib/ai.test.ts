import { describe, expect, it } from "vitest";
import { aiConfigFromEnv, cleanExtraction, extractCardFields, parseExtractionContent, type AiConfig } from "./ai";
import { expectAuthError } from "./fake-db";

const CONFIG: AiConfig = { endpoint: "https://example.invalid/v1", model: "muse-test", apiKey: "k" };

describe("aiConfigFromEnv", () => {
  it("requires endpoint, model, and key", () => {
    expect(aiConfigFromEnv({})).toBeNull();
    expect(aiConfigFromEnv({ META_AI_ENDPOINT: "https://x", META_AI_MODEL: "m" })).toBeNull();
    expect(
      aiConfigFromEnv({ META_AI_ENDPOINT: "https://x", META_AI_MODEL: "m", META_AI_API_KEY: "k" }),
    ).toEqual({ endpoint: "https://x", model: "m", apiKey: "k" });
  });
});

describe("cleanExtraction", () => {
  it("keeps valid fields and normalizes them", () => {
    expect(cleanExtraction({ retailer: "  Bookshop ", balance: "$25.5", expiry: "2027-05-03" })).toEqual({
      retailer: "Bookshop",
      balance: "25.50",
      expiry: "2027-05-03",
    });
  });

  it("drops unreadable fields instead of failing", () => {
    expect(cleanExtraction({ retailer: "Mart", balance: "lots", expiry: "next spring", number: "4111" })).toEqual({
      retailer: "Mart",
    });
    expect(cleanExtraction({ balance: 12 })).toEqual({ balance: "12.00" });
    expect(cleanExtraction(null)).toEqual({});
    expect(cleanExtraction("nope")).toEqual({});
  });
});

describe("parseExtractionContent", () => {
  it("reads plain and fenced JSON", () => {
    expect(parseExtractionContent('{"retailer":"Mart","balance":"3.25"}')).toEqual({ retailer: "Mart", balance: "3.25" });
    expect(parseExtractionContent('```json\n{"retailer":"Mart"}\n```')).toEqual({ retailer: "Mart" });
    expect(parseExtractionContent("I could not read this card.")).toEqual({});
  });
});

describe("extractCardFields", () => {
  const bytes = new TextEncoder().encode("fake-jpeg").buffer as ArrayBuffer;

  function fakeFetch(status: number, body: unknown): typeof fetch {
    return async () => new Response(JSON.stringify(body), { status });
  }

  it("returns cleaned fields from a model reply", async () => {
    const fetchFn = fakeFetch(200, {
      choices: [{ message: { content: '{"retailer":"Mart","balance":"12.5","expiry":"2027-01-15"}' } }],
    });
    await expect(extractCardFields(CONFIG, bytes, "image/jpeg", fetchFn)).resolves.toEqual({
      retailer: "Mart",
      balance: "12.50",
      expiry: "2027-01-15",
    });
  });

  it("posts to the chat completions path of the configured base", async () => {
    let seenUrl = "";
    const fetchFn: typeof fetch = async (input) => {
      seenUrl = String(input);
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"retailer":"Mart"}' } }] }), { status: 200 });
    };
    await extractCardFields(CONFIG, bytes, "image/jpeg", fetchFn);
    expect(seenUrl).toBe("https://example.invalid/v1/chat/completions");
  });

  it("maps provider failures to a graceful 502", async () => {
    await expectAuthError(extractCardFields(CONFIG, bytes, "image/jpeg", fakeFetch(500, {})), 502);
    await expectAuthError(
      extractCardFields(CONFIG, bytes, "image/jpeg", async () => {
        throw new Error("network down");
      }),
      502,
    );
  });

  it("treats an unreadable photo as a 422 with manual fallback copy", async () => {
    const fetchFn = fakeFetch(200, { choices: [{ message: { content: '{"retailer":null}' } }] });
    await expectAuthError(extractCardFields(CONFIG, bytes, "image/jpeg", fetchFn), 422);
  });
});
