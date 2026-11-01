import { expect, test } from "@playwright/test";

test("library index lists articles with search and tag filters", async ({ page }) => {
  await page.goto("/library");
  await expect(page.getByRole("heading", { name: "The Library." })).toBeVisible();
  await expect(page.locator(".lib-card")).toHaveCount(3);

  await page.getByLabel("Search the library").fill("fake website");
  await expect(page.locator(".lib-card:not([hidden])")).toHaveCount(1);
  await expect(page.locator(".lib-card:not([hidden])")).toContainText("fake website");
  await expect(page.locator("#lib-count")).toContainText("1 result");

  await page.getByLabel("Search the library").fill("");
  await page.getByRole("button", { name: "deals" }).click();
  await expect(page.locator(".lib-card:not([hidden])")).toHaveCount(1);
  await expect(page).toHaveURL(/tag=deals/);
});

test("library tag links arrive prefiltered", async ({ page }) => {
  await page.goto("/library?tag=safety");
  await expect(page.locator(".lib-card:not([hidden])")).toHaveCount(1);
  await expect(page.locator(".lib-card:not([hidden])")).toContainText("fake website");
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
});

test("library articles render without JavaScript", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto("/library/evaluating-deals");
  await expect(page.getByRole("heading", { name: "How to evaluate a gift-card deal before you buy" })).toBeVisible();
  await expect(page.locator(".lib-prose")).toContainText("face value");
  await context.close();
});
