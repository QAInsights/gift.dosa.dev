import { expect, test } from "@playwright/test";
import { signup, uniqueEmail } from "./helpers";

const ARTICLE_SLUGS = [
  "small-balances",
  "safe-balance-check",
  "evaluating-deals",
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
];

const DEALS_SLUGS = [
  "evaluating-deals",
  "discounted-vs-bonus-cards",
  "when-deal-not-saving",
  "resale-marketplace-protection",
];

const SAFETY_SLUGS = [
  "safe-balance-check",
  "card-not-activated",
  "lost-or-exposed-card",
  "resale-marketplace-protection",
  "organize-household-cards",
];

test("library index lists articles with search and tag filters", async ({ page }) => {
  await page.goto("/library");
  await expect(page.getByRole("heading", { name: "The Library." })).toBeVisible();
  for (const slug of ARTICLE_SLUGS) {
    await expect(page.locator(`.lib-card[href="/library/${slug}"]`)).toBeVisible();
  }

  await page.getByLabel("Search the library").fill("fake website");
  await expect(page.locator(".lib-card:not([hidden])")).toHaveCount(1);
  await expect(page.locator(".lib-card:not([hidden])")).toContainText("fake website");
  await expect(page.locator("#lib-count")).toContainText("1 result");

  await page.getByLabel("Search the library").fill("");
  await page.getByRole("button", { name: "deals" }).click();
  for (const slug of DEALS_SLUGS) {
    await expect(page.locator(`.lib-card[href="/library/${slug}"]:not([hidden])`)).toBeVisible();
  }
  await expect(page.locator('.lib-card[href="/library/small-balances"]')).toBeHidden();
  await expect(page).toHaveURL(/tag=deals/);
});

test("library tag links arrive prefiltered", async ({ page }) => {
  await page.goto("/library?tag=safety");
  for (const slug of SAFETY_SLUGS) {
    await expect(page.locator(`.lib-card[href="/library/${slug}"]:not([hidden])`)).toBeVisible();
  }
  await expect(page.locator('.lib-card[href="/library/small-balances"]')).toBeHidden();
  const visibleTags = await page
    .locator(".lib-card:not([hidden])")
    .evaluateAll((cards) => cards.map((card) => (card as HTMLElement).dataset.tags ?? ""));
  expect(visibleTags.length).toBeGreaterThan(0);
  for (const tags of visibleTags) {
    expect(tags.split(" ")).toContain("safety");
  }
});

test("article page carries TOC, share, related, and structured data", async ({ page }) => {
  await page.goto("/library/small-balances");
  await expect(page.getByRole("heading", { name: "How to use the last few dollars on a gift card" })).toBeVisible();

  const tocLinks = page.locator("#toc a");
  await expect(tocLinks.first()).toBeVisible();
  const hrefs = await tocLinks.evaluateAll((links) => links.map((link) => link.getAttribute("href")));
  expect(hrefs.length).toBeGreaterThan(0);
  for (const href of hrefs) {
    expect(href).toMatch(/^#/);
    await expect(page.locator(href as string)).toHaveCount(1);
  }

  await expect(page.getByRole("button", { name: "Copy link" })).toBeVisible();
  await expect(page.getByRole("link", { name: "WhatsApp" })).toHaveAttribute(
    "href",
    /wa\.me\/\?text=/,
  );
  await expect(
    page.getByRole("region", { name: "Keep this card" }).getByRole("link", { name: "Start your cabinet" }),
  ).toBeVisible();
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    "https://gift.dosa.dev/library/small-balances",
  );
  await expect(page.locator('meta[property="og:type"][content="article"]')).toHaveCount(1);
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
    "content",
    "https://gift.dosa.dev/og.jpg",
  );
  const ldTypes = await page
    .locator('script[type="application/ld+json"]')
    .evaluateAll((nodes) => nodes.map((node) => JSON.parse(node.textContent ?? "{}")["@type"]));
  expect(ldTypes).toContain("Article");
  expect(ldTypes).toContain("FAQPage");
  expect(ldTypes).toContain("BreadcrumbList");
});

test("unknown library slugs answer 404", async ({ page }) => {
  const response = await page.goto("/library/no-such-guide");
  expect(response?.status()).toBe(404);
});

test("sitemap lists the library pages", async ({ page }) => {
  const response = await page.goto("/sitemap.xml");
  expect(response?.status()).toBe(200);
  const body = (await response?.text()) ?? "";
  expect(body).toContain("https://gift.dosa.dev/library");
  expect(body).toContain("https://gift.dosa.dev/library/small-balances");
  expect(body).toContain("https://gift.dosa.dev/library/safe-balance-check");
  expect(body).toContain("https://gift.dosa.dev/library/evaluating-deals");
  expect(body).toContain("https://gift.dosa.dev/library/amazon-gift-card-guide");
  expect(body).toContain("<lastmod>2026-11-01</lastmod>");
});

test("llms.txt summarizes the library for AI readers", async ({ page }) => {
  const response = await page.goto("/llms.txt");
  expect(response?.status()).toBe(200);
  expect(response?.headers()["content-type"]).toContain("text/plain");
  const body = (await response?.text()) ?? "";
  expect(body).toContain("# Gift Cabinet");
  expect(body).toContain("https://gift.dosa.dev/library/small-balances");
  expect(body).toContain("https://gift.dosa.dev/library/amazon-gift-card-guide");
});

test("robots points crawlers at the sitemap and away from the api", async ({ page }) => {
  const response = await page.goto("/robots.txt");
  expect(response?.status()).toBe(200);
  const body = (await response?.text()) ?? "";
  expect(body).toContain("Sitemap: https://gift.dosa.dev/sitemap.xml");
  expect(body).toContain("Disallow: /api/");
});

test("article rail collapses into a mobile TOC and FAQs render", async ({ page }) => {
  await page.goto("/library/small-balances");
  await expect(page.locator(".lib-rail")).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".lib-rail")).toBeHidden();
  await expect(page.locator("#toc-mobile")).toBeVisible();
  await expect(page.locator("#toc-mobile summary")).toContainText("On this page");
  const faq = page.locator(".lib-faq-item").first();
  await expect(faq.locator("summary")).toContainText("Can I pay with a gift card and a credit card together?");
});

test("signed-in visitors see the Library tab in the app shell", async ({ page }) => {
  await signup(page, uniqueEmail("library"));
  await page.goto("/library");
  const tab = page.locator(".topbar .tab", { hasText: "Library" });
  await expect(tab).toBeVisible();
  await expect(tab).toHaveAttribute("aria-current", "page");
});

test("library articles render without JavaScript", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto("/library/evaluating-deals");
  await expect(page.getByRole("heading", { name: "How to evaluate a gift-card deal before you buy" })).toBeVisible();
  await expect(page.locator(".lib-prose")).toContainText("face value");
  await context.close();
});
