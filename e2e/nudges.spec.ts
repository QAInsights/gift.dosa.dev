import { expect, test } from "@playwright/test";

test("cron nudge endpoint refuses anonymous runs", async ({ request }) => {
  const anonymous = await request.post("/api/cron/nudges");
  expect([401, 503]).toContain(anonymous.status());
  const wrongSecret = await request.post("/api/cron/nudges", {
    headers: { authorization: "Bearer not-the-secret" },
  });
  expect([401, 503]).toContain(wrongSecret.status());
});
