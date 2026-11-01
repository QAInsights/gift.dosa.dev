import { expect, test } from "@playwright/test";
import { signup, uniqueEmail } from "./helpers";

test("amounts mask on home and cabinet, and the choice persists", async ({ page }) => {
  await signup(page, uniqueEmail("mask"));
  await page.goto("/");
  await expect(page.locator(".activity [data-amount]").first()).toBeVisible();
  await expect(page.locator(".stats [data-amount]").first()).toBeVisible();
  await page.getByRole("button", { name: "Hide money" }).click();
  await expect(page.locator("html.amounts-hidden")).toHaveCount(1);

  await page.goto("/cabinet");
  await expect(page.locator("html.amounts-hidden")).toHaveCount(1);
  await expect(page.locator(".summary [data-amount]")).toBeVisible();
  await page.getByRole("button", { name: /Family/ }).click();
  await expect(page.locator(".slot.is-open")).toHaveCount(1);
  await page.getByRole("button", { name: "Close all drawers" }).click();
  await expect(page.locator(".slot.is-open")).toHaveCount(0);
  await page.getByRole("button", { name: "Show money" }).click();
  await expect(page.locator("html.amounts-hidden")).toHaveCount(0);
});

test("drawer settings live in a modal and the emoji picker restyles the rail", async ({ page }) => {
  await signup(page, uniqueEmail("modal"));
  await page.goto("/cabinet?view=list");
  const item = page.locator(".rail-item", { has: page.getByRole("link", { name: /Family/ }) });
  await expect(item.locator(".drawer-emoji")).toHaveText("🏠");

  await item.getByRole("button", { name: "Change emoji for Family" }).click();
  const dialog = page.locator("#drawer-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: /Family/ })).toBeVisible();
  await expect(dialog.locator('[data-manage-panel]:not([hidden]) form[data-action="rename"]')).toBeHidden();
  await expect(dialog.locator('[data-manage-panel]:not([hidden]) form[data-action="delete"]')).toBeHidden();
  await dialog.getByRole("button", { name: "Use 🎂 for Family" }).click();
  await expect(item.locator(".drawer-emoji")).toHaveText("🎂");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Close drawer settings" }).click();
  await expect(dialog).toBeHidden();

  await page.goto("/cabinet");
  const unit = page.locator(".slot", { has: page.getByRole("button", { name: /Family/ }) });
  await unit.getByRole("button", { name: /Family/ }).click();
  await expect(unit.locator(".interior form")).toHaveCount(0);
  await unit.getByRole("button", { name: "Drawer settings" }).click();
  await expect(dialog).toBeVisible();
  await dialog.locator('[data-manage-panel]:not([hidden]) form[data-action="rename"] input[name="name"]').fill("Kin");
  await dialog.locator('[data-manage-panel]:not([hidden]) form[data-action="rename"] input[name="name"]').press("Enter");
  await expect(page.locator(".slot", { hasText: "Kin" }).locator(".label-paper")).toContainText("Kin");
});

test("sealed drawer emoji opens the picker only and restyles without unlocking", async ({ page }) => {
  await signup(page, uniqueEmail("sealed-emoji"));
  await page.goto("/cabinet?view=list");
  await page.getByText("New drawer").click();
  await page.getByLabel("Drawer name").fill("Vaulted");
  await page.getByLabel(/Lock/).fill("drawer-secret");
  await page.getByRole("button", { name: "Create the drawer" }).click();
  await expect(page.getByRole("link", { name: /Vaulted/ })).toBeVisible();

  await page.goto("/cabinet");
  const unit = page.locator(".slot", { has: page.getByRole("button", { name: "Open Vaulted" }) });
  await expect(unit.locator(".label-paper")).toContainText("sealed");

  await page.goto("/cabinet?view=list");
  const item = page.locator(".rail-item", { has: page.getByRole("link", { name: /Vaulted/ }) });
  await item.getByRole("button", { name: "Change emoji for Vaulted" }).click();
  const dialog = page.locator("#drawer-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('[data-manage-panel]:not([hidden]) form[data-action="emoji"]')).toBeVisible();
  await expect(dialog.locator('[data-manage-panel]:not([hidden]) form[data-action="unlock"]')).toBeHidden();
  await dialog.getByRole("button", { name: "Use 🎉 for Vaulted" }).click();
  await expect(item.locator(".drawer-emoji")).toHaveText("🎉");
  await expect(dialog).toBeVisible();

  await page.goto("/cabinet");
  await expect(unit.locator(".label-paper")).toContainText("sealed");
});

test("material studio skin switches timber and persists", async ({ page }) => {
  await signup(page, uniqueEmail("skin"));
  const cabinet = page.locator("#cabinet");
  await expect(cabinet).toHaveAttribute("data-skin", "walnut");
  await page.getByRole("button", { name: /Porcelain sage/ }).click();
  await expect(cabinet).toHaveAttribute("data-skin", "porcelain");
  await expect(page.locator("#skin-description")).toContainText("satin finish");
  await page.reload();
  await expect(cabinet).toHaveAttribute("data-skin", "porcelain");
  await expect(page.getByRole("button", { name: /Porcelain sage/ })).toHaveAttribute("aria-pressed", "true");
});
