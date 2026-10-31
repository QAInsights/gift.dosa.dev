import { expect, test } from "@playwright/test";
import { signup, uniqueEmail } from "./helpers";

const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8Xw8AAwMCAO+ip1sAAAAASUVORK5CYII=",
  "base64",
);

async function snapPhoto(page: import("@playwright/test").Page) {
  await page.goto("/file");
  await page.getByLabel(/Snap the card/).setInputFiles({
    name: "card.png",
    mimeType: "image/png",
    buffer: PNG_1PX,
  });
}

test("snap: a dead connection reads as plain language, not a browser error", async ({ page }) => {
  await signup(page, uniqueEmail("e2e-snap"));
  await page.route("**/api/extract", (route) => route.abort("connectionreset"));
  await snapPhoto(page);
  await page.getByRole("button", { name: "Read the photo" }).click();
  await expect(page.getByText("The reading didn't finish")).toBeVisible();
  await expect(page.getByText("Failed to fetch")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Read the photo" })).toBeEnabled();
});

test("snap: read fields land in the form for checking", async ({ page }) => {
  await signup(page, uniqueEmail("e2e-snap"));
  await page.route("**/api/extract", (route) =>
    route.fulfill({ json: { fields: { retailer: "Bookshop", balance: "25.00", expiry: "2027-05-03" } } }),
  );
  await snapPhoto(page);
  await page.getByRole("button", { name: "Read the photo" }).click();
  await expect(page.getByLabel("Retailer")).toHaveValue("Bookshop");
  await expect(page.getByLabel("Amount")).toHaveValue("25.00");
  await expect(page.getByText("Filled from your photo")).toBeVisible();
});
