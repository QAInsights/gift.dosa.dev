import { expect, test } from "@playwright/test";
import { signup, uniqueEmail } from "./helpers";

test("known stores show their favicon, unknown shops keep the monogram", async ({ page }) => {
  await signup(page, uniqueEmail("stores"));
  await page.goto("/");

  const steamMark = page.locator('img.store-mark-img[src*="domain=steampowered.com"]');
  await expect(steamMark).toHaveCount(1);
  await expect(steamMark).toHaveAttribute("src", "https://www.google.com/s2/favicons?domain=steampowered.com&sz=64");
  await expect(page.locator('img.store-mark-img[src*="domain=wholefoodsmarket.com"]')).toHaveCount(1);

  const bookshopRow = page.locator(".activity-row", { hasText: "Bookshop" });
  await expect(bookshopRow.locator(".monogram")).toHaveText("B");
  await expect(bookshopRow.locator("img.store-mark-img")).toHaveCount(0);

  await page.goto("/cabinet");
  await expect(page.locator('img.store-mark-img[src*="domain=airbnb.com"]')).toHaveCount(1);
  await expect(page.locator('img.store-mark-img[src*="domain=starbucks.com"]')).toHaveCount(1);
});
