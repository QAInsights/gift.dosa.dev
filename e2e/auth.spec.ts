import { expect, test } from "@playwright/test";
import { devCode, signup, uniqueEmail } from "./helpers";

test("signup creates an account and signs out", async ({ page }) => {
  const email = uniqueEmail("e2e-signup");
  await signup(page, email, "E2E");
  await page.goto("/account");
  await expect(page.getByText(email).first()).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("heading", { name: "America loses $23 billion a year on gift cards." })).toBeVisible();
});

test("signin works for an existing account", async ({ page }) => {
  const email = uniqueEmail("e2e-signin");
  await signup(page, email);
  await page.goto("/account");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("heading", { name: "America loses $23 billion a year on gift cards." })).toBeVisible();
  await page.goto("/signin");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send my code" }).click();
  await page.getByLabel("6-digit code").fill(await devCode(page));
  await page.getByRole("button", { name: "Verify", exact: true }).click();
  await expect(page).toHaveURL(/\/cabinet/);
  await expect(page.getByRole("heading", { name: "The cabinet" })).toBeVisible();
});

test("a wrong code shows an error", async ({ page }) => {
  await page.goto("/signin");
  await page.getByLabel("Email").fill(uniqueEmail("e2e-wrong"));
  await page.getByRole("button", { name: "Send my code" }).click();
  await expect(page.locator("#auth-dev-code")).toBeVisible();
  await page.getByLabel("6-digit code").fill("000000");
  await page.getByRole("button", { name: "Verify", exact: true }).click();
  await expect(page.locator("#auth-error")).toContainText("does not match");
});

test("the cabinet redirects strangers to signin", async ({ page }) => {
  await page.goto("/cabinet");
  await expect(page).toHaveURL(/\/signin/);
});
