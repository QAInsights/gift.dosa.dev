import { expect, test } from "@playwright/test";
import { signup, uniqueEmail } from "./helpers";

test("profile settings save to the account and shape filing and dates", async ({ page }) => {
  await signup(page, uniqueEmail("settings"));

  await page.goto("/account");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Account menu" })).toBeVisible();
  await page.getByLabel("Display name").fill("Ada");
  await page.getByLabel("Default currency").selectOption("GBP");
  await page.getByLabel("Date format").selectOption("DMY");
  await expect(page.locator("#prefs-preview")).toContainText("£12.00");
  await expect(page.locator("#profile-help")).toContainText("Saved to your account.");
  await expect(page.locator("#account-name")).toHaveText("Ada");

  await page.goto("/file");
  await expect(page.getByLabel("Currency")).toHaveValue("GBP");
  const filingCurrencies = await page.getByLabel("Currency").locator("option").allTextContents();
  await page.goto("/account");
  const defaultCurrencies = await page.getByLabel("Default currency").locator("option").allTextContents();
  expect(filingCurrencies).toEqual(defaultCurrencies);

  await page.goto("/");
  await expect(page.locator(".spend-next")).toHaveText(/\d{1,2} [A-Z][a-z]{2} \d{4}/);

  const boxOf = (selector: string) =>
    page.locator(selector).evaluate((el) => {
      const box = el.getBoundingClientRect();
      return { left: Math.round(box.left), width: Math.round(box.width) };
    });
  await page.goto("/account");
  const accountBox = await boxOf(".flow");
  await page.goto("/notes");
  const notesBox = await boxOf(".flow");
  await page.goto("/cabinet");
  const cabinetBox = await boxOf(".flow--cabinet");
  expect(notesBox.width).toBe(accountBox.width);
  // One content width: every page fills the same centered container, with
  // text measures handled by inner blocks instead of a narrow page.
  expect(cabinetBox.width).toBe(accountBox.width);
  expect(notesBox.left).toBe(cabinetBox.left);

  await page.goto("/account");
  await expect(page.getByLabel("Display name")).toHaveValue("Ada");
  await expect(page.getByLabel("Default currency")).toHaveValue("GBP");
  await expect(page.getByLabel("Date format")).toHaveValue("DMY");
});

test("settings offers common regions and currencies", async ({ page }) => {
  await signup(page, uniqueEmail("settings-regions"));
  await page.goto("/account");
  const regions = await page.getByLabel("Region").locator("option").allTextContents();
  for (const name of ["Canada", "Australia", "Singapore", "France", "United Arab Emirates"]) {
    expect(regions.join(" ")).toContain(name);
  }
  await page.getByLabel("Region").selectOption("CA");
  await page.getByLabel("Default currency").selectOption("CAD");
  await expect(page.locator("#profile-help")).toContainText("Saved to your account.");
  await page.reload();
  await expect(page.getByLabel("Region")).toHaveValue("CA");
  await expect(page.getByLabel("Default currency")).toHaveValue("CAD");
  await page.goto("/file");
  await expect(page.getByLabel("Currency")).toHaveValue("CAD");
});

test("profile menu opens settings, whatsapp, and sign out", async ({ page }) => {
  await signup(page, uniqueEmail("settings-menu"));
  const menu = page.locator("#profile-menu");
  await page.goto("/cabinet");
  await page.getByRole("button", { name: "Account menu" }).click();
  await expect(menu).toBeVisible();
  await menu.getByRole("link", { name: "Settings" }).click();
  await expect(page).toHaveURL(/\/account$/);

  await page.getByRole("button", { name: "Account menu" }).click();
  await expect(menu).toBeVisible();
  await menu.getByRole("link", { name: "WhatsApp" }).click();
  await expect(page).toHaveURL(/\/account#whatsapp/);
  await expect(page.locator("#whatsapp")).toBeInViewport();

  await page.getByRole("button", { name: "Account menu" }).click();
  await menu.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("link", { name: "Sign in" }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Account menu" })).toHaveCount(0);
});
