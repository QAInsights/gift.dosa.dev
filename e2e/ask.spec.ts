import { expect, test } from "@playwright/test";
import { signup, uniqueEmail } from "./helpers";

test("ask bar answers from the shelf with cited cards", async ({ page }) => {
  await signup(page, uniqueEmail("ask"));
  await page.goto("/");

  const answer = page.locator(".bubble--cab").last();
  await page.getByLabel("Ask the cabinet", { exact: true }).fill("What expires first?");
  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await expect(answer).toContainText("Steam", { timeout: 25000 });
  await expect(answer.locator("a[href^='/cards/']").first()).toBeVisible();

  await page.getByRole("button", { name: "What should I spend first?" }).click();
  await expect(answer).toContainText("Steam", { timeout: 25000 });
  await expect(answer.locator("a[href^='/cards/']").first()).toBeVisible();
});
