import { expect, test } from "@playwright/test";
import { signup, uniqueEmail } from "./helpers";

const SEAL = "drawer-secret";

test("cabinet loop: samples, file, seal, vault, memories", async ({ page }) => {
  page.on("dialog", (dialog) => void dialog.accept());
  await signup(page, uniqueEmail("e2e-cabinet"));
  const soon = new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10);
  const slot = (name: string) => page.locator(".slot", { has: page.getByRole("button", { name: new RegExp(name) }) });
  const front = (name: string) => page.locator(".front", { hasText: name });

  await page.goto("/cabinet?view=list");
  await expect(page.locator(".studio")).toHaveCount(0);
  const toolbarHeights = await page.locator(".toolbar .input, .toolbar .btn").evaluateAll((els) =>
    els.map((el) => Math.round(el.getBoundingClientRect().height)),
  );
  expect(new Set(toolbarHeights).size).toBe(1);

  await expect(page.getByText("You're browsing 6 sample cards.")).toBeVisible();
  await page.getByRole("button", { name: "Clear the samples" }).click();
  await expect(page.locator(".banner")).toHaveCount(0);

  await page.getByText("New drawer").click();
  await page.getByLabel("Drawer name").fill("Food");
  await page.getByRole("button", { name: "Create the drawer" }).click();
  await expect(page.getByRole("link", { name: /Food/ })).toBeVisible();
  await page.getByText("New drawer").click();
  await page.getByLabel("Drawer name").fill("Gifts");
  await page.getByLabel(/Lock/).fill(SEAL);
  await page.getByRole("button", { name: "Create the drawer" }).click();
  await expect(page.getByRole("link", { name: /Gifts/ })).toBeVisible();

  await page.goto("/cabinet");
  await expect(page.locator(".studio")).toBeVisible();
  await expect(front("Personal")).toBeVisible();
  await expect(front("Food")).toBeVisible();
  await expect(slot("Gifts").locator(".label-paper")).toContainText("sealed");

  await page.goto("/file");
  const readBtn = page.getByRole("button", { name: "Read the card" });
  if (await readBtn.isEnabled()) {
    await readBtn.click();
    await expect(page.getByText("Pick a photo first.")).toBeVisible();
  } else {
    await expect(readBtn).toBeDisabled();
    await expect(page.getByText("Photo reading isn't switched on here yet.")).toBeVisible();
  }
  await page.getByLabel("Retailer").fill("Mart");
  await page.getByLabel("Amount").fill("12.50");
  await page.getByLabel("Expires").fill(soon);
  await page.getByLabel("Drawer").selectOption({ label: "Food" });
  await page.getByRole("button", { name: "File it" }).click();
  await expect(page.locator("#filed-stamp")).toBeVisible();

  await page.goto("/cabinet");
  await front("Food").click();
  await expect(slot("Food").getByRole("link", { name: /Mart/ })).toBeVisible();
  await expect(slot("Food").getByText("$12.50").first()).toBeVisible();

  const gifts = slot("Gifts");
  await gifts.getByRole("button", { name: "Open Gifts" }).click();
  const dialog = page.locator("#drawer-dialog");
  await expect(dialog).toBeVisible();
  await dialog.locator('form[data-action="unlock"] input[name="password"]').fill(SEAL);
  await dialog.locator('form[data-action="unlock"] button[type="submit"]').click();
  await expect(page).toHaveURL(/drawer=/);
  await expect(gifts).toHaveClass(/is-open/);
  await expect(gifts.locator(".label-paper")).not.toContainText("Sealed");

  await page.goto("/file");
  await page.getByLabel("Retailer").fill("Secret Shop");
  await page.getByLabel("Amount").fill("99.00");
  await page.getByLabel("Drawer").selectOption({ label: "Gifts" });
  await page.getByRole("button", { name: "File it" }).click();
  await expect(page.locator("#filed-stamp")).toBeVisible();

  await page.goto("/cabinet");
  await front("Gifts").click();
  const secretHref = await gifts.getByRole("link", { name: /Secret Shop/ }).getAttribute("href");
  await gifts.getByRole("button", { name: "Drawer settings" }).click();
  await expect(dialog).toBeVisible();
  await dialog.locator('form[data-action="relock"] button[type="submit"]').click();
  await expect(gifts.locator(".label-paper")).toContainText("sealed");

  await expect(page.getByRole("link", { name: /Secret Shop/ })).toBeHidden();
  await page.goto("/");
  await expect(page.locator(".stats").getByText("$12.50").first()).toBeVisible();

  await page.goto(secretHref as string);
  await expect(page.getByText("Sealed in the Gifts drawer.")).toBeVisible();
  await page.getByLabel("Drawer password").fill(SEAL);
  await page.getByRole("button", { name: "Open the drawer" }).click();
  await expect(page.getByText("$99.00").first()).toBeVisible();

  await page.goto("/");
  await expect(page.locator(".stats").getByText("$111.50")).toBeVisible();
  await page.goto("/cabinet");
  await front("Food").click();
  await slot("Food").getByRole("link", { name: /Mart/ }).click();
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

  await page.goto("/cabinet?view=list");
  await expect(page.locator(".list-card")).toHaveCount(1);

  await page.locator(".list-card", { hasText: "Secret Shop" }).click();
  await page.getByRole("button", { name: "Keep as a memory" }).click();
  await expect(page.getByRole("button", { name: "Unmark as a memory" })).toBeVisible();
  await page.goto("/cabinet?memories=1");
  await expect(page.getByRole("heading", { name: "Memories" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Secret Shop" })).toBeVisible();
});

test("card errors surface in view with focus and explain the memory rule", async ({ page }) => {
  page.on("dialog", (dialog) => void dialog.accept());
  await signup(page, uniqueEmail("card-error"));
  await page.goto("/file");
  await page.getByLabel("Retailer").fill("Audit Focus");
  await page.getByLabel("Amount").fill("10.00");
  await page.getByRole("button", { name: "File it" }).click();
  await page.goto("/cabinet?view=list");
  await page.locator(".list-card", { hasText: "Audit Focus" }).click();
  await page.getByRole("button", { name: "Keep as a memory" }).click();
  await expect(page.getByRole("button", { name: "Unmark as a memory" })).toBeVisible();
  await page.getByText("Discard this card").click();
  await expect(page.getByRole("link", { name: "Unmark it" })).toBeVisible();
  await page.getByRole("button", { name: "Discard it" }).click();
  await expect(page.locator("#card-error")).toContainText("Unmark it as a memory first");
  await expect(page.locator("#card-error")).toBeInViewport();
  await expect(page.locator("#card-error")).toBeFocused();
});
