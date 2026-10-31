import { expect, type Page, test } from "@playwright/test";

export function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.dev`;
}

export async function devCode(page: Page): Promise<string> {
  const notice = page.locator("#auth-dev-code");
  await expect(notice).toBeVisible();
  const match = ((await notice.textContent()) ?? "").match(/(\d{6})/);
  if (!match) throw new Error("no dev code shown");
  return match[1];
}

export async function signup(page: Page, email: string, name?: string): Promise<void> {
  await page.goto("/signup");
  await page.getByLabel("Email").fill(email);
  if (name) await page.getByLabel(/Name/).fill(name);
  await page.getByRole("button", { name: "Send my code" }).click();
  await page.getByLabel("6-digit code").fill(await devCode(page));
  await page.getByRole("button", { name: "Verify", exact: true }).click();
  await expect(page).toHaveURL(/\/cabinet/);
  await expect(page.getByRole("heading", { name: "The cabinet" })).toBeVisible();
}
