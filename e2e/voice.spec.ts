import { expect, test } from "@playwright/test";
import { signup, uniqueEmail } from "./helpers";

test("voice extract returns a draft with review flags", async ({ page }) => {
  await signup(page, uniqueEmail("voice"));
  const res = await page.request.post("/api/voice/extract", {
    data: {
      transcript: "Add a Target gift card with 50 US dollars, from Maya for my birthday.",
      today: "2026-11-02",
      timeZone: "America/New_York",
    },
  });
  expect(res.ok()).toBe(true);
  const body = await res.json();
  expect(body.draft.transcript).toContain("Target");
  expect(body.draft).toHaveProperty("retailer");
  expect(body.draft).toHaveProperty("amount");
  expect(body.draft).toHaveProperty("currencyConfident");
  expect(Array.isArray(body.draft.needsReview)).toBe(true);
});

test("voice extract rejects empty transcripts", async ({ page }) => {
  await signup(page, uniqueEmail("voice-empty"));
  const res = await page.request.post("/api/voice/extract", { data: { transcript: "  " } });
  expect(res.status()).toBe(400);
});

test("file page offers voice with a privacy note", async ({ page }) => {
  await signup(page, uniqueEmail("voice-ui"));
  await page.goto("/file");
  await expect(page.locator("#voice-label")).toContainText("Speak the details");
  await expect(page.getByRole("button", { name: "Start recording" })).toBeVisible();
  await expect(page.locator("#voice-note")).toContainText("Do not say the card number or PIN");
});
