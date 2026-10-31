import { expect, test } from "@playwright/test";
import { signup, uniqueEmail } from "./helpers";

test("homepage tells the story over a sample shelf", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "America left $27 billion on gift cards." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "The forgetting, in figures" })).toBeVisible();
  await expect(page.locator(".ledger")).toContainText("43%");
  await expect(page.locator(".ledger")).toContainText("Bankrate, Sep 2024");
  await expect(page.getByRole("heading", { name: /Drawers are where gift cards go/ })).toBeVisible();
  await expect(page.locator(".figures")).toContainText("30 days");
  await expect(page.getByRole("heading", { name: "How it works" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "A sample shelf" })).toBeVisible();
  await expect(page.locator(".activity")).toContainText("Example Bookshop");
  await expect(page.getByText("A sample shelf. Yours starts empty.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Start your cabinet" }).first()).toHaveAttribute("href", "/signup");
});

test("signed-in homepage shows real recent activity and totals", async ({ page }) => {
  await signup(page, uniqueEmail("home"));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Recent activity" })).toBeVisible();
  await expect(page.getByText(/Your shelf holds \$257\.18/)).toBeVisible();
  await expect(page.locator(".activity").getByRole("link", { name: /Steam/ })).toBeVisible();
  await page.locator(".activity").getByRole("link", { name: /Steam/ }).click();
  await expect(page).toHaveURL(/\/cards\//);
});
