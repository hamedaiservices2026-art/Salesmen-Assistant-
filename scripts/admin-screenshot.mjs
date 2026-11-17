// Usage: node scripts/admin-screenshot.mjs <path> <out.png> [--locale ar|en|ur] [--as owner|admin]
//        [--create-company]   (owner only: fills the new-company form, then captures the invite panel)
// Env: BASE_URL (default http://localhost:3000). Signs in through /admin/signin with the demo
// credentials from `pnpm db:seed` (local database only). Viewport 1440x1000 at scale 1.
import { createRequire } from "node:module";

// Playwright is installed globally; require() honours NODE_PATH where ESM import does not.
const { chromium } = createRequire(import.meta.url)("playwright");

const args = process.argv.slice(2);
const take = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args.splice(i, 2)[1] : null;
};
const locale = take("--locale");
const as = take("--as") ?? "admin";
const ci = args.indexOf("--create-company");
const createCompany = ci >= 0 && args.splice(ci, 1).length === 1;
const [path, out] = args;
if (!path || !out || !["owner", "admin"].includes(as)) {
  console.error("Usage: node scripts/admin-screenshot.mjs <path> <out.png> [--locale ar|en|ur] [--as owner|admin] [--create-company]");
  process.exit(2);
}
const base = process.env.BASE_URL ?? "http://localhost:3000";
const ACCOUNTS = {
  owner: { email: "owner@platform.test", password: "demo-owner-2026" },
  admin: { email: "admin@demo.test", password: "demo-admin-2026" },
};
const { email, password } = ACCOUNTS[as];

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
const page = await context.newPage();

await page.goto(`${base}/admin/signin`, { waitUntil: "load" });
await page.fill('input[name="email"]', email);
await page.fill('input[name="password"]', password);
await page.click('button[type="submit"]');
await page.waitForURL((u) => !u.pathname.endsWith("/signin"), { timeout: 15000 }).catch(() => {});
if (new URL(page.url()).pathname.endsWith("/signin")) {
  console.error("Could not sign in (run `pnpm db:seed` on the same local database first).");
  await browser.close();
  process.exit(1);
}

// Sign-in sets the locale cookie from the user's profile, so apply the requested one afterwards.
if (locale) await context.addCookies([{ name: "locale", value: locale, url: base }]);
await page.goto(`${base}${path}`, { waitUntil: "load" });
await page.waitForSelector("main");
// Let the client hydrate before typing into a form, or the submit can fall back to a plain post.
// (Link prefetching can keep the network busy, so do not wait forever.)
await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});

if (createCompany) {
  const stamp = Date.now().toString(36);
  await page.fill('input[name="name"]', "Pilot Test Co.");
  await page.fill('input[name="adminName"]', "Test Admin");
  await page.fill('input[name="adminEmail"]', `boss-${stamp}@pilot.test`);
  await page.click('main form button[type="submit"]');
  await page.waitForSelector('[role="status"]', { timeout: 15000 });
}
await page.waitForTimeout(400);
const height = await page.evaluate(() => document.documentElement.scrollHeight);
await page.setViewportSize({ width: 1440, height: Math.max(1000, height) });
await page.screenshot({ path: out });
await browser.close();
console.log(`saved ${out}`);
