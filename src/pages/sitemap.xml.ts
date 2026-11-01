import { getCollection } from "astro:content";
import type { APIRoute } from "astro";
import { SITE_ORIGIN, libraryUrl, type LibraryEntry } from "../lib/library";

const STATIC_PATHS = ["/", "/library", "/signup", "/signin"];

export const GET: APIRoute = async () => {
  const entries = (await getCollection("library")) as LibraryEntry[];
  const urls = [
    ...STATIC_PATHS.map((path) => `${SITE_ORIGIN}${path}`),
    ...entries.map((entry) => libraryUrl(entry.id)),
  ];
  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls.map((url) => `  <url><loc>${url}</loc></url>`),
    "</urlset>",
    "",
  ].join("\n");
  return new Response(body, { headers: { "Content-Type": "application/xml" } });
};
