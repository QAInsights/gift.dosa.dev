import { expect, test } from "@playwright/test";
import { signup, uniqueEmail } from "./helpers";

test("filing confirmation shows the amount with its currency", async ({ page }) => {
  await signup(page, uniqueEmail("file-currency"));
  await page.goto("/file");
  await page.getByLabel("Retailer").fill("Audit Bookshop");
  await page.getByLabel("Amount").fill("25.50");
  await page.getByLabel("Currency").selectOption("EUR");
  await page.getByRole("button", { name: "File it" }).click();
  await expect(page.locator("#filed-stamp")).toBeVisible();
  await expect(page.locator("#filed-facts")).toContainText("€25.50");
  await expect(page.locator("#filed-facts")).toContainText("EUR");
});

test("filing errors surface beside the failing field", async ({ page }) => {
  await signup(page, uniqueEmail("file-error"));
  await page.goto("/file");
  await page.getByLabel("Retailer").fill("Audit Invalid");
  await page.getByLabel("Amount").fill("-1");
  await page.getByRole("button", { name: "File it" }).click();
  await expect(page.locator("#file-error")).toContainText("12.50");
  await expect(page.locator("#file-error")).toBeInViewport();
  await expect(page.getByLabel("Amount")).toBeFocused();
});

test("optional filing details stay collapsed until needed", async ({ page }) => {
  await signup(page, uniqueEmail("file-optional"));
  await page.goto("/file");
  const details = page.locator(".optdetails");
  await expect(details).not.toHaveAttribute("open", "");
  await expect(page.getByLabel("Nickname")).toBeHidden();
  await page.getByText("More details").click();
  await expect(page.getByLabel("Nickname")).toBeVisible();
  await page.getByLabel("Retailer").fill("Audit Detailed");
  await page.getByLabel("Amount").fill("9.00");
  await page.getByLabel("Nickname").fill("Birthday from Ana");
  await page.getByRole("button", { name: "File it" }).click();
  await expect(page.locator("#filed-stamp")).toBeVisible();
});
