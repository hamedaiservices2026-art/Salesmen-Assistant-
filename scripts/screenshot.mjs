// Usage: node scripts/screenshot.mjs <path> <out.png> [--locale ar|en|ur]
// Env: BASE_URL (default http://localhost:3000), INVITE (invite path, used when sign-in fails).
import { createRequire } from "node:module";

// Playwright is installed globally; require() honours NODE_PATH where ESM import does not.
const { chromium } = createRequire(import.meta.url)("playwright");

const args = process.argv.slice(2);
const li = args.indexOf("--locale");
const locale = li >= 0 ? args.splice(li, 2)[1] : null;
const [path, out] = args;
if (!path || !out) {
  console.error("Usage: node scripts/screenshot.mjs <path> <out.png> [--locale ar|en|ur]");
  process.exit(2);
}
const base = process.env.BASE_URL ?? "http://localhost:3000";
const LOGIN = "ahmed";
const PIN = "482915";

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
});
const page = await context.newPage();

async function signedIn() {
  const res = await page.goto(`${base}/app/assistant`, { waitUntil: "networkidle" });
  return res?.ok() && new URL(page.url()).pathname.startsWith("/app");
}

async function signIn() {
  await page.goto(`${base}/signin`, { waitUntil: "networkidle" });
  await page.fill('input[name="login"]', LOGIN);
  await page.fill('input[name="pin"]', PIN);
  await page.click('button[type="submit"]');
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(500);
}

async function acceptInvite(invite) {
  await page.goto(`${base}${invite}`, { waitUntil: "networkidle" });
  await page.fill('input[name="pin"]', PIN);
  await page.fill('input[name="confirm"]', PIN);
  await page.click('button[type="submit"]');
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(500);
}

await signIn();
if (!(await signedIn()) && process.env.INVITE) {
  await acceptInvite(process.env.INVITE);
  if (!(await signedIn())) await signIn();
}
if (!(await signedIn())) {
  console.error("Could not sign in (set INVITE to an invite path after db:seed).");
  await browser.close();
  process.exit(1);
}

// Sign-in sets the locale cookie from the user's profile, so apply the requested one afterwards.
if (locale) await context.addCookies([{ name: "locale", value: locale, url: base }]);
await page.goto(`${base}${path}`, { waitUntil: "networkidle" });
// Full-page capture: grow the viewport to the content so the sticky bottom nav lands at the end.
const height = await page.evaluate(() => document.documentElement.scrollHeight);
await page.setViewportSize({ width: 390, height: Math.max(844, height) });
await page.screenshot({ path: out });
await browser.close();
console.log(`saved ${out}`);
