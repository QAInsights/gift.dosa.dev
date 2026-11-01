import { describe, expect, it } from "vitest";
import {
  allTags,
  articleJsonLd,
  breadcrumbJsonLd,
  collectionJsonLd,
  faqJsonLd,
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
