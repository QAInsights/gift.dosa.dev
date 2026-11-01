import { expect, test } from "@playwright/test";
import { signup, uniqueEmail } from "./helpers";

for (const width of [390, 320]) {
  test(`drawer labels stay inside their fronts at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await signup(page, uniqueEmail(`mobile-${width}`));
    await page.goto("/cabinet");
    const fronts = page.locator(".slot .front");
    await expect(fronts.first()).toBeVisible();
    for (const front of await fronts.all()) {
      const frontBox = await front.boundingBox();
      const labelBox = await front.locator(".label-paper").boundingBox();
      expect(frontBox && labelBox).toBeTruthy();
      if (frontBox && labelBox) {
        expect(labelBox.x).toBeGreaterThanOrEqual(frontBox.x - 1);
        expect(labelBox.x + labelBox.width).toBeLessThanOrEqual(frontBox.x + frontBox.width + 1);
      }
    }
  });

  test(`headers keep every action on screen at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await signup(page, uniqueEmail(`header-${width}`));
    await page.goto("/cabinet");
    for (const tab of await page.locator(".topbar .tab").all()) {
      const box = await tab.boundingBox();
      expect(box).toBeTruthy();
      if (box) expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
    }
    await page.context().clearCookies();
    await page.goto("/");
    const cta = page.locator(".site-header").getByRole("link", { name: /Start/ });
    const box = await cta.boundingBox();
    expect(box).toBeTruthy();
    if (box) expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
  });
}

test("account facts wrap long values at 320px", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await signup(page, uniqueEmail("facts-very-long-address-part"));
  await page.goto("/account");
  const panel = page.locator(".panel", { has: page.locator("dt", { hasText: "Email" }) });
  const panelBox = await panel.boundingBox();
  const emailBox = await panel.locator("dd").first().boundingBox();
  expect(panelBox && emailBox).toBeTruthy();
  if (panelBox && emailBox) {
    expect(emailBox.x + emailBox.width).toBeLessThanOrEqual(panelBox.x + panelBox.width + 1);
  }
});
