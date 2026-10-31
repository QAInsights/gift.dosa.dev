import { expect, test } from "@playwright/test";
import { signup, uniqueEmail } from "./helpers";

test("profile settings save to the account and shape filing and dates", async ({ page }) => {
  await signup(page, uniqueEmail("settings"));

  await page.goto("/account");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Account:/ })).toBeVisible();
  await page.getByLabel("Display name").fill("Ada");
  await page.getByLabel("Default currency").selectOption("GBP");
  await page.getByLabel("Date format").selectOption("DMY");
  await expect(page.locator("#prefs-preview")).toContainText("£12.00");
  await expect(page.locator("#profile-help")).toContainText("Saved to your account.");
  await expect(page.locator("#account-name")).toHaveText("Ada");

  await page.goto("/file");
  await expect(page.getByLabel("Currency")).toHaveValue("GBP");

  await page.goto("/cabinet");
  await expect(page.locator(".spend-next")).toHaveText(/\d{1,2} [A-Z][a-z]{2} \d{4}/);

  const widthOf = (selector: string) =>
    page.locator(selector).evaluate((el) => Math.round(el.getBoundingClientRect().width));
  await page.goto("/account");
  const accountWidth = await widthOf(".flow");
  await page.goto("/notes");
  const notesWidth = await widthOf(".flow");
  await page.goto("/cabinet");
  const cabinetWidth = await widthOf(".flow--cabinet");
  expect(notesWidth).toBe(accountWidth);
  expect(cabinetWidth).toBe(accountWidth);

  await page.goto("/account");
  await expect(page.getByLabel("Display name")).toHaveValue("Ada");
  await expect(page.getByLabel("Default currency")).toHaveValue("GBP");
  await expect(page.getByLabel("Date format")).toHaveValue("DMY");
});
