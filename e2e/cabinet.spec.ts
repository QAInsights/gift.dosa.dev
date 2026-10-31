import { expect, test } from "@playwright/test";
import { signup, uniqueEmail } from "./helpers";

const SEAL = "drawer-secret";

test("cabinet loop: samples, doors, file, seal, vault, memories", async ({ page }) => {
  page.on("dialog", (dialog) => void dialog.accept());
  await signup(page, uniqueEmail("e2e-cabinet"));
  const soon = new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10);
  const drawerUnit = (name: string) => page.locator(".cdrawer", { has: page.getByRole("button", { name: new RegExp(name) }) });
  const front = (name: string) => page.locator(".cdrawer-front", { hasText: name });

  const toolbarHeights = await page.locator(".toolbar .input, .toolbar .btn").evaluateAll((els) =>
    els.map((el) => Math.round(el.getBoundingClientRect().height)),
  );
  expect(new Set(toolbarHeights).size).toBe(1);

  await expect(page.getByText("You're browsing 6 sample cards.")).toBeVisible();
  await expect(front("Family")).toBeHidden();
  await page.getByRole("button", { name: "Clear the samples" }).click();
  await expect(page.locator(".banner")).toHaveCount(0);
  await page.getByRole("button", { name: "Open the cabinet" }).click();
  await expect(front("Family")).toBeVisible();
  await expect(front("Personal")).toBeVisible();

  await page.getByText("New drawer").click();
  await page.getByLabel("Drawer name").fill("Food");
  await page.getByRole("button", { name: "Create the drawer" }).click();
  await expect(front("Food")).toBeVisible();
  await page.getByText("New drawer").click();
  await page.getByLabel("Drawer name").fill("Gifts");
  await page.getByLabel(/Lock/).fill(SEAL);
  await page.getByRole("button", { name: "Create the drawer" }).click();
  await expect(drawerUnit("Gifts").locator(".cdrawer-meta")).toContainText("Sealed");

  await page.goto("/file");
  await page.getByRole("button", { name: "Read the card" }).click();
  await expect(page.getByText("Pick a photo first.")).toBeVisible();
  await page.getByLabel("Retailer").fill("Mart");
  await page.getByLabel("Amount").fill("12.50");
  await page.getByLabel("Expires").fill(soon);
  await page.getByLabel("Drawer").selectOption({ label: "Food" });
  await page.getByRole("button", { name: "File it" }).click();
  await expect(page.locator("#filed-stamp")).toBeVisible();

  await page.goto("/cabinet");
  await front("Food").click();
  await expect(drawerUnit("Food").getByRole("link", { name: /Mart/ })).toBeVisible();
  await expect(drawerUnit("Food").getByText("$12.50").first()).toBeVisible();

  const gifts = drawerUnit("Gifts");
  await gifts.getByRole("button", { name: "Open Gifts" }).click();
  const dialog = page.locator("#drawer-dialog");
  await expect(dialog).toBeVisible();
  await dialog.locator('form[data-action="unlock"] input[name="password"]').fill(SEAL);
  await dialog.locator('form[data-action="unlock"] button[type="submit"]').click();
  await expect(gifts.locator(".cdrawer-meta")).not.toContainText("Sealed");

  await page.goto("/file");
  await page.getByLabel("Retailer").fill("Secret Shop");
  await page.getByLabel("Amount").fill("99.00");
  await page.getByLabel("Drawer").selectOption({ label: "Gifts" });
  await page.getByRole("button", { name: "File it" }).click();
  await expect(page.locator("#filed-stamp")).toBeVisible();

  await page.goto("/cabinet");
  await front("Gifts").click();
  const secretHref = await gifts.getByRole("link", { name: /Secret Shop/ }).getAttribute("href");
  await gifts.getByRole("button", { name: "Seal Gifts" }).click();
  await expect(dialog).toBeVisible();
  await dialog.locator('form[data-action="relock"] button[type="submit"]').click();
  await expect(gifts.locator(".cdrawer-meta")).toContainText("Sealed");

  await expect(page.getByRole("link", { name: /Secret Shop/ })).toBeHidden();
  await expect(page.locator(".stats").getByText("$12.50").first()).toBeVisible();

  await page.goto(secretHref as string);
  await expect(page.getByText("Sealed in the Gifts drawer.")).toBeVisible();
  await page.getByLabel("Drawer password").fill(SEAL);
  await page.getByRole("button", { name: "Open the drawer" }).click();
  await expect(page.getByText("$99.00").first()).toBeVisible();

  await page.goto("/cabinet");
  await expect(page.locator(".stats").getByText("$111.50")).toBeVisible();
  await front("Food").click();
  await drawerUnit("Food").getByRole("link", { name: /Mart/ }).click();
  await expect(page.locator("dl.facts").getByText("A week before")).toBeVisible();
  await page.getByLabel("Balance").fill("8.00");
  await page.getByLabel("Remind me").selectOption("");
  await page.getByRole("button", { name: "Save the changes" }).click();
  await expect(page.getByText("$8.00").first()).toBeVisible();
  await expect(page.locator("dl.facts").getByText("Off", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Keep as a memory" }).click();
  await expect(page.getByRole("button", { name: "Unmark as a memory" })).toBeVisible();
  await page.getByText("Discard this card").click();
  await page.getByRole("button", { name: "Discard it" }).click();
  await expect(page.locator("#card-error")).toContainText("keepsakes");
  await page.getByRole("button", { name: "Unmark as a memory" }).click();
  await expect(page.getByRole("button", { name: "Keep as a memory" })).toBeVisible();
  await page.getByText("Discard this card").click();
  await page.getByRole("button", { name: "Discard it" }).click();
  await expect(page).toHaveURL(/\/cabinet/);

  await front("Gifts").click();
  await gifts.getByRole("link", { name: /Secret Shop/ }).click();
  await page.getByLabel("Card number").fill("4111222233334402");
  await page.getByLabel("PIN").fill("9021");
  await page.getByRole("button", { name: "Seal the vault" }).click();
  await expect(page.getByText("•••• •••• •••• ••••")).toBeVisible();
  await page.getByRole("button", { name: "Reveal to copy" }).click();
  await expect(page.getByRole("button", { name: "Copy the number" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy the PIN" })).toBeVisible();

  await page.goto("/cabinet?view=grid");
  await expect(page.locator(".tile")).toHaveCount(1);

  await page.locator(".tile", { hasText: "Secret Shop" }).click();
  await page.getByRole("button", { name: "Keep as a memory" }).click();
  await expect(page.getByRole("button", { name: "Unmark as a memory" })).toBeVisible();
  await page.goto("/cabinet?memories=1");
  await expect(page.getByRole("heading", { name: "Memories" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Secret Shop" })).toBeVisible();
});
