// End-to-end check: temporary local database, seed, production build, then the rep flow in a browser.
// Usage: pnpm e2e   (builds first; takes a few minutes). The developer's .data directory is never touched.
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Playwright is installed globally; require() honours NODE_PATH where ESM import does not.
let chromium;
try {
  ({ chromium } = createRequire(import.meta.url)("playwright"));
} catch {
  console.error("Cannot load Playwright. It is not a project dependency: install it globally (npm i -g playwright) and make sure NODE_PATH includes the global node_modules.");
  process.exit(1);
}

const PIN = "482915";
const checks = [];
let server;
let serverExited = false;
let browser;
let dataRoot;

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

/** Whole-token match: the figure is not part of a longer number (118 is not in 1,180 or 118.5). */
function containsToken(text, figure) {
  const esc = figure.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\d,.])${esc}(?!\\d|[,.]\\d)`).test(text);
}
const hasToken = (name, text, figure) =>
  check(name, containsToken(text, figure), `token "${figure}"`, text.replace(/\s+/g, " "));
const hasNoToken = (name, text, figure) =>
  check(name, !containsToken(text, figure), `no token "${figure}"`, `found "${figure}"`);

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
    if (serverExited) fail("server exited before it was ready");
    try {
      const res = await fetch(`${base}/signin`);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  fail("server did not start within 60 seconds");
}

async function main() {
  // A throwaway database directory: the developer's .data is not touched, and nothing else uses this one.
  dataRoot = mkdtempSync(join(tmpdir(), "salesman-e2e-"));
  const env = {
    APP_TODAY: "2026-11-14",
    ALLOW_APP_TODAY: "1",
    ALLOW_LOCAL_DB: "1",
    PGLITE_DIR: join(dataRoot, "pglite"),
  };
  delete process.env.DATABASE_URL;

  console.log("Building...");
  run("pnpm", ["build"]);
  const seedOut = run("pnpm", ["db:seed"], env);
  const invites = [...seedOut.matchAll(/\/invite\/\S+/g)].map((m) => m[0]);
  if (invites.length < 2) fail(`expected two invite paths in seed output, found: ${seedOut}`);
  const [ahmedInvite, otherInvite] = invites;

  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  server = spawn("node_modules/.bin/next", ["start", "-p", String(port), "-H", "127.0.0.1"], {
    stdio: ["ignore", "inherit", "inherit"],
    env: { ...process.env, ...env, NODE_ENV: "production" },
  });
  server.once("exit", () => {
    serverExited = true;
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
  const breakdown = page.locator('section[aria-label="كشف العمولة"] > ul > li');
  const rows = await breakdown.count();
  check("commission breakdown has the four scheme rows", rows === 4, "4 rows", rows);
  has("commission breakdown names the food component", (await breakdown.allInnerTexts()).join(" "), "قيمة الأغذية");

  // History.
  await page.goto(`${base}/app/history/2026-11`, { waitUntil: "load" });
  const days = await page.locator('main ul[aria-label] > li > h2').allInnerTexts();
  check("history has the 14 Nov row", days.some((d) => /\s14$/.test(d.trim())), "a day row ending in 14", JSON.stringify(days));

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

  // The other company's rep must not see Ahmed's figures, and the check must be able to fail.
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page2 = await ctx2.newPage();
  await acceptInvite(page2, otherInvite);
  await signIn(page2, "other-rep");
  await page2.waitForURL(/\/app$/, { timeout: 15000 }).catch(() => {});
  check("other rep signed in", path(page2) === "/app", "/app", page2.url());

  // What a person sees on the page: the text plus what sits in the input fields.
  const visible = async (pg) => {
    const main = await pg.locator("main").innerText();
    const values = await pg.$$eval("input", (els) => els.map((e) => e.value));
    return `${main}\n${values.join("\n")}`;
  };
  const open = async (pg, p) => {
    const res = await pg.goto(`${base}${p}`, { waitUntil: "load" });
    const url = new URL(pg.url());
    return { status: res?.status(), landed: url.pathname + url.search, text: await visible(pg) };
  };
  const pages = [
    // path, a figure Ahmed's own session shows there, the other rep's own marker
    { p: "/app/close?date=2026-11-12", control: ["106"], marker: "مبيعات" },
    { p: "/app/history/2026-11", control: ["118", "8,100"], marker: "مبيعات" },
  ];
  const ahmedFigures = ["118", "8,100", "1,140", "1,270", "106"];
  for (const { p, control, marker } of pages) {
    // Positive control: Ahmed's own session does show his figures on the same URL.
    const own = await open(page, p);
    check(`Ahmed gets ${p} (200, no redirect)`, own.status === 200 && own.landed === p, `200 at ${p}`, `${own.status} ${own.landed}`);
    for (const f of control) hasToken(`Ahmed's own ${p} shows ${f} (control)`, own.text, f);
    // The other rep: the page rendered for them, then Ahmed's figures are absent.
    const other = await open(page2, p);
    check(`other rep gets ${p} (200, no redirect)`, other.status === 200 && other.landed === p, `200 at ${p}`, `${other.status} ${other.landed}`);
    has(`other rep's ${p} shows their own line`, other.text, marker);
    for (const f of ahmedFigures) hasNoToken(`${p} hides ${f} from the other company`, other.text, f);
  }
}

async function cleanup() {
  await browser?.close().catch(() => {});
  browser = undefined;
  if (server && !serverExited) {
    await new Promise((resolve) => {
      const kill = setTimeout(() => server.kill("SIGKILL"), 5000);
      server.once("exit", () => {
        clearTimeout(kill);
        resolve();
      });
      server.kill("SIGTERM");
    });
  }
  // The database directory goes only after the server that held it has exited.
  if (dataRoot) rmSync(dataRoot, { recursive: true, force: true });
  dataRoot = undefined;
}

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.once(sig, () => {
    console.error(`\n${sig}: cleaning up`);
    cleanup().finally(() => process.exit(130));
  });
}

let code = 0;
try {
  await main();
  console.log(`\nAll ${checks.length} checks passed.`);
} catch (e) {
  console.error(`\n${e.message}`);
  code = 1;
} finally {
  await cleanup();
}
process.exit(code);
