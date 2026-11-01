import { getCollection } from "astro:content";
import type { APIRoute } from "astro";
import { SITE_ORIGIN, libraryUrl, type LibraryEntry } from "../lib/library";

const STATIC_PATHS = ["/", "/library", "/signup", "/signin"];

function lastmod(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export const GET: APIRoute = async () => {
  const entries = ((await getCollection("library")) as LibraryEntry[]).sort(
    (a, b) => b.data.published.getTime() - a.data.published.getTime(),
  );
  const urls = [
    ...STATIC_PATHS.map((path) => `  <url><loc>${SITE_ORIGIN}${path}</loc></url>`),
    ...entries.map(
      (entry) =>
        `  <url><loc>${libraryUrl(entry.id)}</loc><lastmod>${lastmod(entry.data.updated ?? entry.data.published)}</lastmod></url>`,
    ),
  ];
  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    "</urlset>",
    "",
  ].join("\n");
  return new Response(body, { headers: { "Content-Type": "application/xml" } });
};
