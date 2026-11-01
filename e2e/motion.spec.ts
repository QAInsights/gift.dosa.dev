import { expect, test } from "@playwright/test";
import { signup, uniqueEmail } from "./helpers";

test.use({ reducedMotion: "no-preference" });

test("home dashboard shows the gathering beside the heading", async ({ page }) => {
  await signup(page, uniqueEmail("motion-home"));
  await page.goto("/");
  const fig = page.locator(".motion-fig[data-scene='home']");
  await expect(fig.locator("svg")).toBeVisible();
  await expect(fig).toHaveAttribute("aria-hidden", "true");
  await expect(fig.locator("svg")).toHaveAttribute("focusable", "false");
  const figBox = await fig.boundingBox();
  const headBox = await page.getByRole("heading", { name: "What's on your shelf." }).boundingBox();
  expect(figBox && headBox).toBeTruthy();
  if (figBox && headBox) {
    expect(figBox.width).toBeGreaterThan(0);
    expect(figBox.height).toBeGreaterThan(0);
    expect(figBox.x).toBeGreaterThan(headBox.x);
  }
  await expect(fig).toHaveClass(/motion-run/, { timeout: 5000 });
});

test("empty cabinet list pairs the figure with the first-card action", async ({ page }) => {
  page.on("dialog", (dialog) => void dialog.accept());
  await signup(page, uniqueEmail("motion-empty"));
  await page.goto("/cabinet?view=list");
  await page.getByRole("button", { name: "Clear the samples" }).click();
  const fig = page.locator(".motion-fig[data-scene='cabinet']");
  await expect(fig.locator("svg")).toBeVisible();
  const action = page
    .getByRole("region", { name: "Cards as a simple list" })
    .getByRole("link", { name: "File a card" });
  await expect(action).toBeVisible();
  const figBox = await fig.boundingBox();
  const actionBox = await action.boundingBox();
  expect(figBox && actionBox).toBeTruthy();
  if (figBox && actionBox) {
    expect(actionBox.x + actionBox.width).toBeLessThanOrEqual(figBox.x + 1);
  }
});

test("populated cabinet and furniture views carry no figure", async ({ page }) => {
  await signup(page, uniqueEmail("motion-quiet"));
  await page.goto("/cabinet?view=list");
  await expect(page.locator(".motion-fig")).toHaveCount(0);
  await page.goto("/cabinet");
  await expect(page.locator(".motion-fig")).toHaveCount(0);
});

test("file companion shows on desktop and hides on phones", async ({ page }) => {
  await signup(page, uniqueEmail("motion-file"));
  await page.goto("/file");
  await expect(page.locator(".motion-fig[data-scene='file'] svg")).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".motion-fig[data-scene='file']")).toBeHidden();
  await page.setViewportSize({ width: 320, height: 800 });
  await expect(page.locator(".motion-fig[data-scene='file']")).toBeHidden();
});

test("returning within a session does not replay the entrance", async ({ page }) => {
  await signup(page, uniqueEmail("motion-once"));
  await page.goto("/");
  const fig = page.locator(".motion-fig[data-scene='home']");
  await expect(fig).toHaveClass(/motion-run/, { timeout: 5000 });
  await page.goto("/cabinet");
  await page.goto("/");
  const again = page.locator(".motion-fig[data-scene='home']");
  await expect(again.locator("svg")).toBeVisible();
  await page.waitForTimeout(1500);
  await expect(again).not.toHaveClass(/motion-run/);
});

test("card detail pairs the facts with the detail figure", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signup(page, uniqueEmail("motion-detail"));
  await page.goto("/cabinet?view=list");
  await page.locator("a[href^='/cards/']").first().click();
  const fig = page.locator(".motion-fig[data-scene='detail']");
  await expect(fig.locator("svg")).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(fig).toBeHidden();
});

test("notes empty state shows the figure until the first note lands", async ({ page }) => {
  await signup(page, uniqueEmail("motion-notes"));
  await page.goto("/notes");
  const fig = page.locator(".motion-fig[data-scene='notes']");
  await expect(fig.locator("svg")).toBeVisible();
  await page.getByLabel("New note").fill("Ribbon for Maya's parcel");
  await page.getByRole("button", { name: "Add to the list" }).click();
  await expect(page.locator(".motion-fig")).toHaveCount(0);
});

test("settings figure shows on desktop and hides on phones", async ({ page }) => {
  await signup(page, uniqueEmail("motion-settings"));
  await page.goto("/account");
  const fig = page.locator(".motion-fig[data-scene='settings']");
  await expect(fig.locator("svg")).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(fig).toBeHidden();
});

test("auth shows the envelope on desktop, hides it on phones, and keeps email first", async ({ page }) => {
  await page.goto("/signin");
  const fig = page.locator(".motion-fig[data-scene='auth']");
  await expect(fig.locator("svg")).toBeVisible();
  await page.getByLabel("Email").focus();
  await expect(page.getByLabel("Email")).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(fig).toBeHidden();
});

test("the 404 keeps the recovery action above the artwork on phones", async ({ page }) => {
  await page.goto("/no-such-page");
  const fig = page.locator(".motion-fig[data-scene='missing']");
  await expect(fig.locator("svg")).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  const figBox = await fig.boundingBox();
  const backBox = await page.getByRole("link", { name: "Back home" }).boundingBox();
  expect(figBox && backBox).toBeTruthy();
  if (figBox && backBox) {
    expect(figBox.y).toBeGreaterThan(backBox.y + backBox.height);
    expect(figBox.height).toBeLessThanOrEqual(161);
  }
});

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("figures stay static with no running animations", async ({ page }) => {
    await signup(page, uniqueEmail("motion-reduced"));
    await page.goto("/");
    const fig = page.locator(".motion-fig[data-scene='home']");
    await expect(fig.locator("svg")).toBeVisible();
    await expect(fig).not.toHaveClass(/motion-run/);
    const running = await fig.evaluate((el) => el.getAnimations({ subtree: true }).length);
    expect(running).toBe(0);
  });
});

test("figures render statically without JavaScript", async ({ browser }) => {
  const withJs = await browser.newContext();
  const setup = await withJs.newPage();
  await signup(setup, uniqueEmail("motion-nojs"));
  const state = await withJs.storageState();
  await withJs.close();
  const withoutJs = await browser.newContext({ javaScriptEnabled: false, storageState: state });
  const page = await withoutJs.newPage();
  await page.goto("/file");
  const fig = page.locator(".motion-fig[data-scene='file']");
  await expect(fig.locator("svg")).toBeVisible();
  await expect(fig).not.toHaveClass(/motion-run/);
  await withoutJs.close();
});
