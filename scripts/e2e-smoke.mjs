// End-to-end check: fresh local database, seed, production build, then the rep flow in a browser.
// Usage: pnpm e2e   (builds first; takes a few minutes)
import { spawn, spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";

// Playwright is installed globally; require() honours NODE_PATH where ESM import does not.
const { chromium } = createRequire(import.meta.url)("playwright");

const PIN = "482915";
const checks = [];
let server;
let browser;

function fail(msg) {
  throw new Error(msg);
}
function check(name, ok, expected, found) {
  if (!ok) fail(`FAIL ${name}\n  expected: ${expected}\n  found:    ${String(found).slice(0, 300)}`);
  checks.push(name);
  console.log(`ok   ${name}`);
}
const has = (name, text, needle) =>
  check(name, text.includes(needle), `text containing "${needle}"`, text.replace(/\s+/g, " "));
const hasNot = (name, text, needle) =>
  check(name, !text.includes(needle), `text without "${needle}"`, `found "${needle}"`);

function run(cmd, args, env = {}) {
  const r = spawnSync(cmd, args, { stdio: ["ignore", "pipe", "inherit"], encoding: "utf8", env: { ...process.env, ...env } });
  if (r.status !== 0) fail(`${cmd} ${args.join(" ")} exited with ${r.status}`);
  return r.stdout;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

async function waitForServer(base) {
  for (let i = 0; i < 120; i++) {
    try {
      const res = await fetch(`${base}/signin`);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  fail("server did not start within 60 seconds");
}

async function main() {
  const env = { APP_TODAY: "2026-11-14", ALLOW_APP_TODAY: "1" };
  delete process.env.DATABASE_URL;

  console.log("Building...");
  run("pnpm", ["build"]);
  rmSync(".data", { recursive: true, force: true });
  const seedOut = run("pnpm", ["db:seed"]);
  const invites = [...seedOut.matchAll(/\/invite\/\S+/g)].map((m) => m[0]);
  if (invites.length < 2) fail(`expected two invite paths in seed output, found: ${seedOut}`);
  const [ahmedInvite, otherInvite] = invites;

  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  server = spawn("node_modules/.bin/next", ["start", "-p", String(port), "-H", "127.0.0.1"], {
    stdio: ["ignore", "inherit", "inherit"],
    env: { ...process.env, ...env, NODE_ENV: "production" },
  });
  await waitForServer(base);

  browser = await chromium.launch();
  const body = (page) => page.locator("body").innerText();
  const submit = async (page) => {
    await Promise.all([page.waitForURL((u) => u.href !== page.url(), { waitUntil: "load" }).catch(() => {}), page.click('button[type="submit"]')]);
    await page.waitForLoadState("load");
  };
  const acceptInvite = async (page, invite) => {
    await page.goto(`${base}${invite}`, { waitUntil: "load" });
    await page.fill('input[name="pin"]', PIN);
    await page.fill('input[name="confirm"]', PIN);
    await submit(page);
  };
  const signIn = async (page, login) => {
    await page.goto(`${base}/signin`, { waitUntil: "load" });
    await page.fill('input[name="login"]', login);
    await page.fill('input[name="pin"]', PIN);
    await submit(page);
  };
  const path = (page) => new URL(page.url()).pathname;

  // Ahmed: invite, PIN, home.
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await acceptInvite(page, ahmedInvite);
  await page.waitForURL(/\/app$/, { timeout: 15000 }).catch(() => {});
  check("invite lands on /app", path(page) === "/app", "/app", page.url());
  let text = await body(page);
  has("home shows 1,140", text, "1,140");
  has("home shows 38%", text, "38%");

  // Day close.
  await page.goto(`${base}/app/close`, { waitUntil: "load" });
  await page.fill('input[name="line.bev"]', "130");
  await page.fill('input[name="line.food"]', "8250.50");
  await page.fill('input[name="line.coll"]', "19000");
  await page.fill('input[name="cashSales"]', "14800");
  await Promise.all([page.waitForURL(/\/app$/, { timeout: 15000 }).catch(() => {}), page.click('button[type="submit"]')]);
  await page.waitForLoadState("load");
  check("close confirm returns to /app", path(page) === "/app", "/app", `${page.url()} :: ${(await body(page)).replace(/\s+/g, " ")}`);
  text = await body(page);
  has("home shows 1,270 after the close", text, "1,270");
  has("home marks today's close as recorded", text, "قفلة النهارده اتسجّلت");

  // Commission.
  await page.goto(`${base}/app/commission`, { waitUntil: "load" });
  const headline = (await page.locator("header h2 + span bdi").first().innerText()).trim();
  check("commission headline is a number", /^\d[\d,]*(\.\d+)?$/.test(headline), "digits, optional commas and decimals", headline);
  const rows = await page.locator("main ul li").count();
  check("commission breakdown is non-empty", rows > 0, "at least one breakdown row", rows);

  // History.
  await page.goto(`${base}/app/history/2026-11`, { waitUntil: "load" });
  const days = await page.locator("main ul li h2").allInnerTexts();
  check("history has the 14 Nov row", days.some((d) => /\b14\b/.test(d)), "a day row containing 14", JSON.stringify(days));

  // Language: English, then back to Arabic.
  await page.goto(`${base}/app/settings`, { waitUntil: "load" });
  await Promise.all([page.waitForLoadState("load"), page.click('button[name="locale"][value="en"]')]);
  await page.waitForTimeout(500);
  await page.goto(`${base}/app`, { waitUntil: "load" });
  has("English home reads Beverages", await body(page), "Beverages");
  await page.goto(`${base}/app/settings`, { waitUntil: "load" });
  await Promise.all([page.waitForLoadState("load"), page.click('button[name="locale"][value="ar"]')]);
  await page.waitForTimeout(500);
  await page.goto(`${base}/app`, { waitUntil: "load" });
  has("Arabic home reads مشروبات", await body(page), "مشروبات");

  // Sign out and back in.
  await page.goto(`${base}/app/settings`, { waitUntil: "load" });
  await page.locator("form button", { hasText: "تسجيل الخروج" }).click();
  await page.waitForURL(/\/signin/, { timeout: 15000 }).catch(() => {});
  check("sign out lands on /signin", path(page) === "/signin", "/signin", page.url());
  await signIn(page, "ahmed");
  await page.waitForURL(/\/app$/, { timeout: 15000 }).catch(() => {});
  check("sign in again lands on /app", path(page) === "/app", "/app", page.url());

  // The other company's rep must not see Ahmed's figures.
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page2 = await ctx2.newPage();
  await acceptInvite(page2, otherInvite);
  await signIn(page2, "other-rep");
  await page2.waitForURL(/\/app$/, { timeout: 15000 }).catch(() => {});
  check("other rep signed in", path(page2) === "/app", "/app", page2.url());
  for (const p of ["/app/close?date=2026-11-12", "/app/history/2026-11"]) {
    const res = await ctx2.request.get(`${base}${p}`);
    const html = await res.text();
    for (const figure of ["118", "8,100", "1,140", "1,270"]) {
      hasNot(`${p} hides ${figure} from the other company`, html, figure);
    }
  }
}

let code = 0;
try {
  await main();
  console.log(`\nAll ${checks.length} checks passed.`);
} catch (e) {
  console.error(`\n${e.message}`);
  code = 1;
} finally {
  await browser?.close().catch(() => {});
  server?.kill();
}
process.exit(code);
