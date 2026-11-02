import { expect, test, type Page } from "@playwright/test";
import { signup, uniqueEmail } from "./helpers";

async function fileCard(page: Page, retailer: string, balance: string, tags: string) {
  const res = await page.request.post("/api/cards", {
    data: { retailer, balance, currency: "USD", tags },
  });
  expect(res.ok()).toBe(true);
}

test("errand planner matches errands to live cards", async ({ page }) => {
  await signup(page, uniqueEmail("plan"));
  await fileCard(page, "Corner Grocer", "42.18", "groceries");
  await fileCard(page, "Blue Bottle", "7.35", "coffee");

  await page.goto("/");
  await page.getByRole("tab", { name: "Plan" }).click();
  await page.getByLabel("List your errands").fill("groceries, coffee");
  await page.getByRole("button", { name: "Plan", exact: true }).click();
  const result = page.locator("#ask-thread .bubble--cab").last();
  await expect(result.locator(".plan-summary")).toContainText("Corner Grocer $42.18 for groceries");
  await expect(result.locator(".plan-summary")).toContainText("Blue Bottle $7.35 for coffee");
  await expect(result.locator(".plan-summary")).toContainText("$49.53 covered across 2 errands");
  await expect(result.locator(".plan-lines li")).toHaveCount(2);
  await expect(result.locator(".plan-lines li").first().locator("a")).toHaveAttribute("href", /\/cards\//);
});

test("errand planner says plainly when nothing fits", async ({ page }) => {
  await signup(page, uniqueEmail("plan-empty"));
  expect((await page.request.delete("/api/samples")).ok()).toBe(true);
  await page.goto("/");
  await page.getByRole("tab", { name: "Plan" }).click();
  await page.getByLabel("List your errands").fill("yacht");
  await page.getByRole("button", { name: "Plan", exact: true }).click();
  const result = page.locator("#ask-thread .bubble--cab").last();
  await expect(result.locator(".plan-summary")).toContainText(/Nothing on the shelf|No cards are filed yet/);
});
