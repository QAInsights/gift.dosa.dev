import { expect, test } from "@playwright/test";
import { signup, uniqueEmail } from "./helpers";

test("whatsapp: linking code appears on the account page", async ({ page }) => {
  await signup(page, uniqueEmail("wa-link"));
  await page.goto("/account");
  await page.getByLabel("Your WhatsApp number").fill("15551234567");
  await page.getByRole("button", { name: "Get linking code" }).click();
  await expect(page.locator("#wa-code")).toContainText(/LINK [A-Z2-9]{6}/);
  await expect(page.locator("#wa-help")).toContainText("Code ready");
  const open = page.locator("#wa-open");
  await expect(open).toBeVisible();
  await expect(open).toHaveAttribute("href", /^https:\/\/wa\.me\/15550512386\?text=LINK%20/);
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByRole("button", { name: "Copy the message" }).click();
  await expect(page.locator("#wa-help")).toContainText("Copied");
  await expect(page.evaluate(() => navigator.clipboard.readText())).resolves.toMatch(/^LINK [A-Z2-9]{6}$/);
});

test("whatsapp: webhook rejects bad verification and needs config", async ({ page, request }) => {
  await signup(page, uniqueEmail("wa-hook"));
  const verify = await request.get("/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=abc");
  expect(verify.status()).toBe(403);
  const inbound = await request.post("/api/whatsapp/webhook", { data: {} });
  expect(inbound.status()).toBe(503);
});
