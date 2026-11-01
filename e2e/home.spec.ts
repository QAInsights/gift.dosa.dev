import { expect, test } from "@playwright/test";
import { signup, uniqueEmail } from "./helpers";

test("homepage shows the Keeper cabinet, facts, and closing", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Good gifts deserve a better drawer." })).toBeVisible();
  const drawer = page.getByRole("button", { name: /The everyday drawer/ });
  await expect(drawer).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("#drawer-detail")).toBeHidden();
  await drawer.click();
  await expect(drawer).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#drawer-detail")).toContainText("Three little possibilities");
  await expect(page.getByRole("heading", { name: "The forgetting, in figures" })).toBeVisible();
  await expect(page.locator(".k-cards")).toContainText("$50.00");
  await expect(page.locator(".k-cards")).toContainText("$12.00");
  await expect(page.locator(".k-cards")).toContainText("$25.00");
  await expect(page.locator(".ledger")).toContainText("43%");
  await expect(page.locator(".ledger")).toContainText("Capital One Shopping, 2026");
  await expect(page.getByRole("heading", { name: "Less remembering. More enjoying." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "A gift is meant to be enjoyed." })).toBeVisible();
  await expect(page.getByRole("link", { name: "Start your cabinet" }).first()).toHaveAttribute("href", "/signup");
});

test("signed-in homepage shows real recent activity and totals", async ({ page }) => {
  await signup(page, uniqueEmail("home"));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "What's on your shelf." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "The forgetting, in figures" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Recent activity" })).toBeVisible();
  await expect(page.locator(".stats").getByText("$257.18")).toBeVisible();
  await expect(page.locator(".activity").getByRole("link", { name: /Steam/ })).toBeVisible();
  await page.locator(".activity").getByRole("link", { name: /Steam/ }).click();
  await expect(page).toHaveURL(/\/cards\//);
});

test("signed-in nav reaches the home dashboard with Ask and stats", async ({ page }) => {
  await signup(page, uniqueEmail("home-nav"));
  await page.goto("/cabinet");
  await page.getByRole("link", { name: "Home" }).click();
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("heading", { name: "What's on your shelf." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ask" })).toBeVisible();
  await expect(page.getByRole("button", { name: "What expires first?" })).toBeVisible();
  await expect(page.locator(".stats").getByText("$257.18")).toBeVisible();
  const topOf = (selector: string) => page.locator(selector).evaluate((el) => el.getBoundingClientRect().top);
  expect(await topOf(".ask-panel")).toBeLessThan(await topOf("#stats-title"));
  expect(await topOf("#stats-title")).toBeLessThan(await topOf("#activity"));
});
