import { expect, test, type Page } from "@playwright/test";
import { signup, uniqueEmail } from "./helpers";

async function openFirstCard(page: Page): Promise<void> {
  await page.goto("/cabinet?view=list");
  await page.locator("a[href^='/cards/']").first().click();
  await expect(page.locator(".balance")).toBeVisible();
}

test("quick update spends, records, and undoes a balance", async ({ page }) => {
  await signup(page, uniqueEmail("redeem"));
  await openFirstCard(page);
  const before = (await page.locator(".balance").textContent()) ?? "";

  await page.getByLabel("Amount").fill("10");
  await page.getByRole("button", { name: "Update", exact: true }).click();
  await expect(page.locator("#spend-help")).toContainText("→");
  await expect(page.locator("#spend-help")).toContainText("Record it?");

  await page.getByRole("button", { name: "Record it" }).click();
  await expect(page.locator(".balance")).not.toHaveText(before);
  await expect(page.locator("#spend-last")).toContainText("→");
  await expect(page.getByRole("button", { name: "Undo" })).toBeVisible();

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.locator(".balance")).toHaveText(before);
});

test("overspend stops at the preview without a network call", async ({ page }) => {
  await signup(page, uniqueEmail("redeem-over"));
  await openFirstCard(page);

  await page.getByLabel("Amount").fill("999999");
  await page.getByRole("button", { name: "Update", exact: true }).click();
  await expect(page.locator("#spend-help")).toContainText("more than");
  await expect(page.locator("#spend-confirm")).toBeHidden();
});

test("remaining sets the balance outright", async ({ page }) => {
  await signup(page, uniqueEmail("redeem-remaining"));
  await openFirstCard(page);

  await page.getByLabel("Remaining is").check();
  await page.getByLabel("Amount").fill("5");
  await page.getByRole("button", { name: "Update", exact: true }).click();
  await expect(page.locator("#spend-help")).toContainText("Record it?");
  await page.getByRole("button", { name: "Record it" }).click();
  await expect(page.locator(".balance")).toContainText("5.00");
});
