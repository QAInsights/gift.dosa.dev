import { describe, expect, it } from "vitest";
import {
  allTags,
  articleJsonLd,
  breadcrumbJsonLd,
  collectionJsonLd,
  faqJsonLd,
  featuredArt,
  formatLibraryDate,
  libraryUrl,
  readingMinutes,
  relatedEntries,
  type LibraryEntry,
} from "./library";

function stubEntry(overrides: Partial<LibraryEntry["data"]> & { id: string }): LibraryEntry {
  return {
    id: overrides.id,
    collection: "library",
    body: "word ".repeat(450).trim(),
    data: {
      title: "Title",
      description: "Description",
      summary: "Summary",
      tags: [],
      kind: "article",
      published: new Date("2026-11-01T00:00:00Z"),
      faqs: [],
      ...overrides,
    },
  } as LibraryEntry;
}

describe("library helpers", () => {
  it("builds canonical library URLs", () => {
    expect(libraryUrl("small-balances")).toBe("https://gift.dosa.dev/library/small-balances");
  });

  it("estimates reading time from the body", () => {
    expect(readingMinutes("word ".repeat(450))).toBe(3);
    expect(readingMinutes("short")).toBe(1);
  });

  it("formats dates for readers", () => {
    expect(formatLibraryDate(new Date("2026-11-01T00:00:00Z"))).toBe("Nov 1, 2026");
  });

  it("collects a sorted tag list", () => {
    const entries = [
      stubEntry({ id: "a", tags: ["spending", "deals"] }),
      stubEntry({ id: "b", tags: ["safety", "spending"] }),
    ];
    expect(allTags(entries)).toEqual(["deals", "safety", "spending"]);
  });

  it("relates entries by shared tags, newest first on ties", () => {
    const current = stubEntry({ id: "now", tags: ["spending", "balances"] });
    const entries = [
      current,
      stubEntry({ id: "old", tags: ["spending"], published: new Date("2026-10-01T00:00:00Z") }),
      stubEntry({ id: "new", tags: ["spending"], published: new Date("2026-11-01T00:00:00Z") }),
      stubEntry({ id: "far", tags: ["safety"] }),
      stubEntry({ id: "close", tags: ["spending", "balances"] }),
    ];
    expect(relatedEntries(entries, current).map((entry) => entry.id)).toEqual([
      "close",
      "new",
      "old",
    ]);
  });
});

describe("library structured data", () => {
  it("describes articles with dates and publisher", () => {
    const node = articleJsonLd(stubEntry({ id: "a" }));
    expect(node["@type"]).toBe("Article");
    expect(node).toMatchObject({
      headline: "Title",
      mainEntityOfPage: "https://gift.dosa.dev/library/a",
      datePublished: "2026-11-01T00:00:00.000Z",
      image: "https://gift.dosa.dev/og.jpg",
    });
    expect(node.publisher).toMatchObject({
      "@type": "Organization",
      name: "Gift Cabinet",
      logo: { "@type": "ImageObject", url: "https://gift.dosa.dev/icons/icon-512.png" },
    });
  });

  it("omits empty FAQ blocks", () => {
    expect(faqJsonLd(stubEntry({ id: "a" }))).toBeNull();
    const node = faqJsonLd(stubEntry({ id: "a", faqs: [{ q: "Q?", a: "A." }] }));
    expect(node?.["@type"]).toBe("FAQPage");
  });

  it("lists the collection and the breadcrumb trail", () => {
    const collection = collectionJsonLd([stubEntry({ id: "a" })]);
    expect(collection["@type"]).toBe("CollectionPage");
    const trail = breadcrumbJsonLd(stubEntry({ id: "a", title: "Title" }));
    expect(trail["@type"]).toBe("BreadcrumbList");
  });
});

describe("featuredArt", () => {
  const fake = (id: string, data = {}): Parameters<typeof featuredArt>[0] =>
    ({ id, data: { title: "T", description: "D", summary: "S", tags: [], kind: "article", published: new Date(), faqs: [], ...data } }) as Parameters<typeof featuredArt>[0];

  it("is deterministic per slug", () => {
    expect(featuredArt(fake("small-balances"))).toEqual(featuredArt(fake("small-balances")));
  });

  it("uses at least two palettes across the real slugs", () => {
    const arts = [
      "evaluating-deals",
      "safe-balance-check",
      "small-balances",
      "works-in-store-not-online",
      "combine-gift-cards",
      "record-after-partial-spend",
      "expiry-vs-promotional-credit",
      "card-not-activated",
      "lost-or-exposed-card",
      "discounted-vs-bonus-cards",
      "when-deal-not-saving",
      "resale-marketplace-protection",
      "organize-household-cards",
      "amazon-gift-card-guide",
      "target-giftcard-guide",
      "walmart-gift-card-guide",
      "starbucks-card-guide",
      "apple-gift-card-guide",
    ].map((id) => featuredArt(fake(id)));
    expect(new Set(arts.map((a) => `${a.from}>${a.to}`)).size).toBeGreaterThanOrEqual(2);
  });

  it("maps the first tag to an emoji and lets frontmatter win", () => {
    expect(featuredArt(fake("x", { tags: ["safety"] })).emoji).toBe("🔒");
    expect(featuredArt(fake("x", { tags: ["deals"] })).emoji).toBe("🏷️");
    expect(featuredArt(fake("x", { tags: ["troubleshooting"] })).emoji).toBe("🔧");
    expect(featuredArt(fake("x", { tags: ["buying"] })).emoji).toBe("🛒");
    expect(featuredArt(fake("x", { tags: ["expiry"] })).emoji).toBe("⏳");
    expect(featuredArt(fake("x", { tags: ["organizing"] })).emoji).toBe("🗂️");
    expect(featuredArt(fake("x", { emoji: "🌟", tags: ["deals"] })).emoji).toBe("🌟");
    expect(featuredArt(fake("x")).emoji).toBe("🎁");
  });

  it("keeps the angle between 100 and 159 degrees", () => {
    for (const id of ["a", "bb", "ccc", "small-balances", "evaluating-deals", "resale-marketplace-protection"]) {
      const { angle } = featuredArt(fake(id));
      expect(angle).toBeGreaterThanOrEqual(100);
      expect(angle).toBeLessThanOrEqual(159);
    }
  });
});
