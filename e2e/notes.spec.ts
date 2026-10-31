import { expect, test } from "@playwright/test";
import { signup, uniqueEmail } from "./helpers";

test("notes: add, complete, and delete a to-do", async ({ page }) => {
  await signup(page, uniqueEmail("notes"));
  await expect.poll(() => page.evaluate(() => !!document.getElementById("i-note"))).toBe(true);
  await page.getByRole("link", { name: "Notes" }).click();
  await expect(page.getByRole("heading", { name: "Notes" })).toBeVisible();

  await page.getByLabel("New note").fill("Maya likes the blue scarf");
  await page.getByRole("button", { name: "Add to the list" }).click();
  const item = page.locator(".todo", { hasText: "Maya likes the blue scarf" });
  await expect(item).toBeVisible();

  await item.getByRole("button", { name: "Mark done: Maya likes the blue scarf" }).click();
  await expect(item.locator(".todo-text.is-done")).toBeVisible();
  await expect(item.getByRole("button", { name: "Reopen: Maya likes the blue scarf" })).toBeVisible();

  await item.getByRole("button", { name: "Delete: Maya likes the blue scarf" }).click();
  await expect(page.locator(".todo")).toHaveCount(0);
  await expect(page.getByText("Nothing here yet.")).toBeVisible();
});
