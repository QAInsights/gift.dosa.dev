import { getCollection } from "astro:content";
import type { APIRoute } from "astro";
import { SITE_ORIGIN, libraryUrl, type LibraryEntry } from "../lib/library";

export const GET: APIRoute = async () => {
  const entries = ((await getCollection("library")) as LibraryEntry[]).sort(
    (a, b) => b.data.published.getTime() - a.data.published.getTime(),
  );
  const guides = entries.filter((entry) => entry.data.kind === "guide");
  const articles = entries.filter((entry) => entry.data.kind !== "guide");
  const lines = [
    "# Gift Cabinet",
    "",
    "> Gift Cabinet reads, files, and reminds about every gift card you own. The public Library below teaches gift card owners to spend balances well, avoid scams and mistakes, and buy discounted cards wisely.",
    "",
    "## Start here",
    "",
    `- [Gift Cabinet home](${SITE_ORIGIN}/): what the product does.`,
    `- [Library](${SITE_ORIGIN}/library): every guide and article, with search and topic filters.`,
    `- [Sign up](${SITE_ORIGIN}/signup): start a cabinet.`,
    "",
  ];
  if (guides.length > 0) {
    lines.push("## Retailer guides", "");
    for (const entry of guides) {
      lines.push(`- [${entry.data.title}](${libraryUrl(entry.id)}): ${entry.data.description}`);
    }
    lines.push("");
  }
  if (articles.length > 0) {
    lines.push("## Articles", "");
    for (const entry of articles) {
      lines.push(`- [${entry.data.title}](${libraryUrl(entry.id)}): ${entry.data.description}`);
    }
    lines.push("");
  }
  return new Response(lines.join("\n"), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
};
