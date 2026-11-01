export const SITE_ORIGIN = "https://gift.dosa.dev";

export interface LibraryFaq {
  q: string;
  a: string;
}

export interface LibraryEntryData {
  title: string;
  description: string;
  summary: string;
  tags: string[];
  kind: "article" | "guide";
  retailer?: string;
  published: Date;
  updated?: Date;
  faqs: LibraryFaq[];
}

export interface LibraryEntry {
  id: string;
  body?: string;
  collection: "library";
  data: LibraryEntryData;
}

export function libraryUrl(slug: string): string {
  return `${SITE_ORIGIN}/library/${slug}`;
}

export function readingMinutes(body: string | undefined): number {
  const words = (body ?? "").trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 200));
}

export function formatLibraryDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function allTags(entries: LibraryEntry[]): string[] {
  const tags = new Set<string>();
  for (const entry of entries) {
    for (const tag of entry.data.tags) tags.add(tag);
  }
  return [...tags].sort((a, b) => a.localeCompare(b));
}

export function relatedEntries(entries: LibraryEntry[], current: LibraryEntry, limit = 3): LibraryEntry[] {
  const wanted = new Set(current.data.tags);
  return entries
    .filter((entry) => entry.id !== current.id)
    .map((entry) => ({
      entry,
      shared: entry.data.tags.filter((tag) => wanted.has(tag)).length,
    }))
    .filter((row) => row.shared > 0)
    .sort(
      (a, b) => b.shared - a.shared || b.entry.data.published.getTime() - a.entry.data.published.getTime(),
    )
    .slice(0, limit)
    .map((row) => row.entry);
}

export function articleJsonLd(entry: LibraryEntry): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: entry.data.title,
    description: entry.data.description,
    mainEntityOfPage: libraryUrl(entry.id),
    datePublished: entry.data.published.toISOString(),
    dateModified: (entry.data.updated ?? entry.data.published).toISOString(),
    author: { "@type": "Organization", name: "Gift Cabinet", url: SITE_ORIGIN },
    publisher: { "@type": "Organization", name: "Gift Cabinet", url: SITE_ORIGIN },
  };
}

export function faqJsonLd(entry: LibraryEntry): Record<string, unknown> | null {
  if (entry.data.faqs.length === 0) return null;
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: entry.data.faqs.map((faq) => ({
      "@type": "Question",
      name: faq.q,
      acceptedAnswer: { "@type": "Answer", text: faq.a },
    })),
  };
}

export function collectionJsonLd(entries: LibraryEntry[]): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "Gift Cabinet Library",
    url: `${SITE_ORIGIN}/library`,
    mainEntity: {
      "@type": "ItemList",
      itemListElement: entries.map((entry, i) => ({
        "@type": "ListItem",
        position: i + 1,
        name: entry.data.title,
        url: libraryUrl(entry.id),
      })),
    },
  };
}

export function breadcrumbJsonLd(entry: LibraryEntry): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${SITE_ORIGIN}/` },
      { "@type": "ListItem", position: 2, name: "Library", item: `${SITE_ORIGIN}/library` },
      { "@type": "ListItem", position: 3, name: entry.data.title, item: libraryUrl(entry.id) },
    ],
  };
}
