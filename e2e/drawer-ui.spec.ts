import { expect, test } from "@playwright/test";
import { signup, uniqueEmail } from "./helpers";

test("amounts mask on home and cabinet, and the choice persists", async ({ page }) => {
  await signup(page, uniqueEmail("mask"));
  await page.goto("/");
  await expect(page.locator(".activity [data-amount]").first()).toBeVisible();
  await page.getByRole("button", { name: "Hide money" }).click();
  await expect(page.locator("html.amounts-hidden")).toHaveCount(1);

  await page.goto("/cabinet");
  await expect(page.locator("html.amounts-hidden")).toHaveCount(1);
  await expect(page.locator(".stats [data-amount]").first()).toBeVisible();
  await page.getByRole("button", { name: "Show money" }).click();
  await expect(page.locator("html.amounts-hidden")).toHaveCount(0);
});

test("drawer settings live in a modal and the emoji picker restyles the header", async ({ page }) => {
  await signup(page, uniqueEmail("modal"));
  const family = page.locator(".cdrawer", { hasText: "Family" });
  await page.getByRole("button", { name: "Open the cabinet" }).click();
  await expect(family.locator(".drawer-emoji")).toHaveText("🎁");
  await expect(family.locator(".pull")).toHaveCount(0);
  await expect(family.locator(".tray-well form")).toHaveCount(0);

  await family.getByRole("button", { name: "Change emoji for Family" }).click();
  const dialog = page.locator("#drawer-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: /Family/ })).toBeVisible();
  await expect(dialog.locator('[data-manage-panel]:not([hidden]) form[data-action="rename"]')).toBeHidden();
  await expect(dialog.locator('[data-manage-panel]:not([hidden]) form[data-action="delete"]')).toBeHidden();
  await dialog.getByRole("button", { name: "Use 🎂 for Family" }).click();
  await expect(family.locator(".drawer-emoji")).toHaveText("🎂");

  await family.getByRole("button", { name: "Rename Family" }).click();
  await expect(dialog).toBeVisible();
  await dialog.locator('[data-manage-panel]:not([hidden]) form[data-action="rename"] input[name="name"]').fill("Kin");
  await dialog.getByRole("button", { name: "Rename", exact: true }).click();
  await expect(page.locator(".cdrawer", { hasText: "Kin" }).locator(".drawer-emoji")).toHaveText("🎂");
});
