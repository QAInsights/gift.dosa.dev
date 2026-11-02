import { describe, expect, it } from "vitest";
import type { AiConfig } from "./ai";
import { expectAuthError } from "./fake-db";
import {
  extractVoiceDraft,
  fallbackDraft,
  normalizeTranscript,
  parseVoiceContent,
  validateDraft,
  type VoiceContext,
} from "./voice";

const CONFIG: AiConfig = { endpoint: "https://example.invalid/v1", model: "muse-test", apiKey: "k" };
const CTX: VoiceContext = {
  drawers: [
    { id: "d1", name: "Birthdays" },
    { id: "d2", name: "Work" },
  ],
  defaultCurrency: "USD",
  today: "2026-11-02",
  timeZone: "America/New_York",
};

describe("normalizeTranscript", () => {
  it("trims and caps the transcript", () => {
    expect(normalizeTranscript("  hello  ")).toBe("hello");
  });

  it("rejects empty and oversized input", async () => {
    await expectAuthError((async () => normalizeTranscript("  "))(), 400);
    await expectAuthError((async () => normalizeTranscript("x".repeat(1001)))(), 400);
  });
});

describe("validateDraft", () => {
  const transcript = "Add a Target gift card with 50 US dollars, from Maya for my birthday. Put it in Personal.";

  it("accepts a clean draft and always flags the amount", () => {
    const draft = validateDraft(
      {
        retailer: "Target",
        amount: 50,
        currency: "USD",
        currencyWords: "US dollars",
        expiry: null,
        occasion: "birthday",
        giver: "Maya",
        drawer: "Personal",
      },
      transcript,
      CTX,
    );
    expect(draft).toMatchObject({
      retailer: "Target",
      amount: "50.00",
      currency: "USD",
      currencyConfident: true,
      expiry: null,
      occasion: "birthday",
      notes: "From Maya.",
      drawerId: "",
      drawerName: "Personal",
      transcript,
    });
    expect(draft.needsReview).toContain("amount");
    expect(draft.needsReview).not.toContain("currency");
  });

  it("proposes the default currency for bare dollars, visibly unconfident", () => {
    const draft = validateDraft({ amount: 50, currency: null, currencyWords: "dollars" }, transcript, CTX);
    expect(draft.currency).toBe("USD");
    expect(draft.currencyConfident).toBe(false);
    expect(draft.needsReview).toContain("currency");
  });

  it("downgrades a model ISO code invented from bare dollars", () => {
    const draft = validateDraft({ amount: 50, currency: "USD", currencyWords: "dollars" }, transcript, CTX);
    expect(draft.currency).toBe("USD");
    expect(draft.currencyConfident).toBe(false);
    expect(draft.needsReview).toContain("currency");
  });

  it("matches drawers by name and flags unknown ones without creating", () => {
    const known = validateDraft({ drawer: "birthdays please" }, transcript, CTX);
    expect(known.drawerId).toBe("d1");
    expect(known.drawerName).toBe("Birthdays");
    expect(known.needsReview).not.toContain("drawer");
    const unknown = validateDraft({ drawer: "Mars" }, transcript, CTX);
    expect(unknown.drawerId).toBeNull();
    expect(unknown.needsReview).toContain("drawer");
  });

  it("drops invalid and past expiry dates", () => {
    expect(validateDraft({ expiry: "2026-12-01" }, transcript, CTX).expiry).toBe("2026-12-01");
    const past = validateDraft({ expiry: "2026-01-01" }, transcript, CTX);
    expect(past.expiry).toBeNull();
    expect(past.needsReview).toContain("expiry");
    const garbage = validateDraft({ expiry: "someday" }, transcript, CTX);
    expect(garbage.expiry).toBeNull();
    expect(garbage.needsReview).toContain("expiry");
  });

  it("flags a missing retailer and keeps the transcript", () => {
    const draft = validateDraft({ amount: 10 }, transcript, CTX);
    expect(draft.retailer).toBeNull();
    expect(draft.needsReview).toContain("retailer");
    expect(draft.transcript).toBe(transcript);
  });

  it("rejects absurd amounts", () => {
    expect(validateDraft({ amount: -5 }, transcript, CTX).amount).toBeNull();
    expect(validateDraft({ amount: "abc" }, transcript, CTX).amount).toBeNull();
  });
});

describe("parseVoiceContent", () => {
  it("parses fenced and embedded JSON", () => {
    expect(parseVoiceContent('```json\n{"retailer":"Target"}\n```')).toEqual({ retailer: "Target" });
    expect(parseVoiceContent('Sure: {"retailer":"Target"} done')).toEqual({ retailer: "Target" });
  });

  it("returns null for prose and non-objects", () => {
    expect(parseVoiceContent("Target, probably.")).toBeNull();
    expect(parseVoiceContent('["Target"]')).toBeNull();
    expect(parseVoiceContent("not json")).toBeNull();
  });
});

describe("fallbackDraft", () => {
  it("extracts the worked example end to end", () => {
    const draft = fallbackDraft(
      "Add a Target gift card with 50 US dollars, from Maya for my birthday. Put it in Personal.",
      CTX,
    );
    expect(draft).toMatchObject({
      retailer: "Target",
      amount: "50.00",
      currency: "USD",
      currencyConfident: true,
      occasion: "Birthday",
      notes: "From Maya.",
      drawerId: "",
      drawerName: "Personal",
    });
    expect(draft.needsReview).toContain("amount");
  });

  it("hears word numbers and resolves next Friday", () => {
    const draft = fallbackDraft("Add a Shell gift card with fifty dollars, expires next Friday.", CTX);
    expect(draft.amount).toBe("50.00");
    expect(draft.currency).toBe("USD");
    expect(draft.currencyConfident).toBe(false);
    expect(draft.expiry).toBe("2026-11-06");
  });

  it("distinguishes fifteen from fifty", () => {
    expect(fallbackDraft("Starbucks gift card with fifteen dollars.", CTX).amount).toBe("15.00");
    expect(fallbackDraft("Starbucks gift card with fifty dollars.", CTX).amount).toBe("50.00");
  });

  it("leaves blank what it cannot hear", () => {
    const draft = fallbackDraft("Umm, a gift card.", CTX);
    expect(draft.retailer).toBeNull();
    expect(draft.amount).toBeNull();
    expect(draft.expiry).toBeNull();
    expect(draft.needsReview).toContain("retailer");
  });
});

describe("extractVoiceDraft", () => {
  function fakeFetch(status: number, body: unknown): typeof fetch {
    return async () => new Response(JSON.stringify(body), { status });
  }

  it("uses the model draft through validation", async () => {
    const out = await extractVoiceDraft(
      CONFIG,
      "Target gift card, 50 US dollars.",
      CTX,
      fakeFetch(200, {
        choices: [{ message: { content: '{"retailer":"Target","amount":50,"currency":"USD","currencyWords":"US dollars"}' } }],
      }),
    );
    expect(out.retailer).toBe("Target");
    expect(out.amount).toBe("50.00");
    expect(out.currencyConfident).toBe(true);
  });

  it("falls back when the model fails or garbles", async () => {
    const down = await extractVoiceDraft(CONFIG, "Target gift card with 50 US dollars.", CTX, fakeFetch(500, {}));
    expect(down.retailer).toBe("Target");
    expect(down.amount).toBe("50.00");
    const garbled = await extractVoiceDraft(
      CONFIG,
      "Target gift card with 50 US dollars.",
      CTX,
      fakeFetch(200, { choices: [{ message: { content: "Target, probably." } }] }),
    );
    expect(garbled.retailer).toBe("Target");
    const missing = await extractVoiceDraft(CONFIG, "Target gift card with 50 US dollars.", CTX, async () => {
      throw new Error("offline");
    });
    expect(missing.retailer).toBe("Target");
    const unconfigured = await extractVoiceDraft(null, "Target gift card with 50 US dollars.", CTX);
    expect(unconfigured.retailer).toBe("Target");
  });
});
