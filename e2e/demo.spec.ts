import { expect, test } from "@playwright/test";
import { signup, uniqueEmail } from "./helpers";

test("demo seed builds the storybook cabinet for the signed-in user", async ({ page }) => {
  await signup(page, uniqueEmail("demo"));
  const res = await page.request.post("/api/dev/demo");
  expect(res.ok()).toBeTruthy();

  await page.goto("/cabinet?view=list");
  await expect(page.getByText("Whole Foods").first()).toBeVisible();
  await expect(page.getByText("Delta").first()).toBeVisible();
  await expect(page.getByText("Family").first()).toBeVisible();

  const starbucks = page.locator("a[href^='/cards/']", { hasText: "Starbucks" }).first();
  await starbucks.click();
  await expect(page.locator("#spend-last")).toContainText("→");
  await expect(page.getByRole("button", { name: "Undo" })).toBeVisible();

  await page.goto("/notes");
  await expect(page.locator(".todo")).toHaveCount(3);

  await page.goto("/cabinet?view=list");
  await expect(page.locator(".banner")).toHaveCount(0);
});
