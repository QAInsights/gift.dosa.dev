import { chromium } from "@playwright/test";

const BASE = process.env.BASE_URL ?? "http://localhost:4321";
const EMAIL = "demo@gift.dosa.dev";
const NAME = "Diya";

try {
  const browser = await chromium.launch();
  const page = await (await browser.newContext()).newPage();
  await page.goto(`${BASE}/signup`);
  await page.getByLabel("Email").fill(EMAIL);
  const name = page.getByLabel(/Name/);
  if (await name.count()) await name.fill(NAME);
  await page.getByRole("button", { name: "Send my code" }).click();
  await page.locator("#auth-dev-code").waitFor();
  const code = ((await page.locator("#auth-dev-code").textContent()) ?? "").match(/\d{6}/)?.[0];
  if (!code) throw new Error("No dev code shown on the signup screen.");
  await page.getByLabel("6-digit code").fill(code);
  await page.getByRole("button", { name: "Verify", exact: true }).click();
  await page.waitForURL(/cabinet/);

  const res = await page.request.post(`${BASE}/api/dev/demo`);
  if (!res.ok()) throw new Error(`POST /api/dev/demo failed: ${res.status()} ${await res.text()}`);

  console.log("Demo account ready");
  console.log("  Sign in:  demo@gift.dosa.dev  (code shown on screen in dev)");
  console.log("  Family drawer password: cabinet-demo");
  console.log("  Try: /  ·  /cabinet  ·  /cards/<steam-id>  ·  /notes  ·  /account");
  await browser.close();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
