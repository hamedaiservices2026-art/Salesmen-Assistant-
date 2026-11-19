// End-to-end check of the owner's path: temporary local database, demo seed, production build, then
// owner -> company -> admin -> rep -> lines -> targets -> published scheme -> the rep's commission screen.
// Usage: pnpm e2e:admin   (builds first; takes a few minutes). The developer's .data directory is never touched.
// The tier amounts typed here (111 and 222 SAR) are synthetic test values, not pilot figures.
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import ExcelJS from "exceljs";
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

// Interface copy comes from the Arabic catalogue, so a reworded button does not break this script.
const catalogue = JSON.parse(readFileSync(new URL("../src/i18n/messages/ar.json", import.meta.url), "utf8"));
const copy = (key) => {
  const v = key.split(".").reduce((a, k) => a?.[k], catalogue);
  if (typeof v !== "string") throw new Error(`Missing catalogue key ${key}`);
  return v;
};

const OWNER = { email: "owner@platform.test", password: "demo-owner-2026" };
const ADMIN = { email: "pilot-admin@example.test", password: "pilot-admin-pass-2026" };
// Local-only sample credentials of the demo seed (see src/db/seed.ts); never a real database.
const DEMO_ADMIN = { email: "admin@demo.test", password: "demo-admin-2026" };
const PIN = "482915";
const checks = [];
let server;
let serverExited = false;
let serverError;
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
const step = (title) => console.log(`\n== ${title}`);
const squash = (text) => text.replace(/\s+/g, " ");
const has = (name, text, needle) => check(name, text.includes(needle), `text containing "${needle}"`, squash(text));

/** Whole-token match: the figure is not part of a longer number (111 is not in 1,110 or 111.5). */
function containsToken(text, figure) {
  const esc = figure.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\d,.])${esc}(?!\\d|[,.]\\d)`).test(text);
}
const hasToken = (name, text, figure) => check(name, containsToken(text, figure), `token "${figure}"`, squash(text));

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
    if (serverError) fail(`server could not start: ${serverError.message}`);
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
  dataRoot = mkdtempSync(join(tmpdir(), "salesman-e2e-admin-"));
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

  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  server = spawn("node_modules/.bin/next", ["start", "-p", String(port), "-H", "127.0.0.1"], {
    stdio: ["ignore", "inherit", "inherit"],
    env: { ...process.env, ...env, NODE_ENV: "production" },
  });
  server.once("error", (e) => {
    // A failed spawn never emits "exit": mark the server gone so cleanup does not wait for it.
    serverError = e;
    serverExited = true;
  });
  server.once("exit", () => {
    serverExited = true;
  });
  await waitForServer(base);

  browser = await chromium.launch();
  const newPage = async (viewport = { width: 1440, height: 1000 }) => (await browser.newContext({ viewport })).newPage();
  const body = (page) => page.locator("body").innerText();
  const path = (page) => new URL(page.url()).pathname;
  const goto = (page, p) => page.goto(`${base}${p}`, { waitUntil: "load" });
  /** Submits the form that holds `inside` and waits for the page to move on (a redirect). */
  const submitToUrl = async (page, inside, pattern) => {
    await Promise.all([page.waitForURL(pattern, { timeout: 20000 }), page.locator(`form:has(${inside}) button[type="submit"]`).click()]);
    await page.waitForLoadState("load");
  };
  const inviteIn = async (page) => {
    const link = page.locator("output");
    await link.first().waitFor({ timeout: 20000 });
    const found = /\/(?:admin\/)?invite\/\S+/.exec(await link.first().innerText());
    if (!found) fail(`no invite link on the page: ${squash(await body(page))}`);
    return found[0];
  };

  step("Owner creates the company");
  // 1. The owner signs in and creates the company.
  const owner = await newPage();
  await goto(owner, "/admin/signin");
  await owner.fill('input[name="email"]', OWNER.email);
  await owner.fill('input[name="password"]', OWNER.password);
  await submitToUrl(owner, 'input[name="email"]', /\/admin\/companies$/);
  check("owner lands on /admin/companies", path(owner) === "/admin/companies", "/admin/companies", owner.url());
  await owner.fill('input[name="name"]', "Pilot Test Co.");
  await owner.fill('input[name="adminName"]', "Pilot Admin");
  await owner.fill('input[name="adminEmail"]', ADMIN.email);
  await owner.locator('form:has(input[name="adminEmail"]) button[type="submit"]').click();
  const adminInvite = await inviteIn(owner);
  check("the admin invite is an /admin/invite link", adminInvite.startsWith("/admin/invite/"), "/admin/invite/<token>", adminInvite);
  has("the new company is listed", await body(owner), "Pilot Test Co.");

  step("Admin accepts the invite");
  // 2. The admin opens the invite and sets a password; this signs him in.
  const admin = await newPage();
  await goto(admin, adminInvite);
  await admin.fill('input[name="password"]', ADMIN.password);
  await admin.fill('input[name="confirm"]', ADMIN.password);
  await submitToUrl(admin, 'input[name="confirm"]', (u) => !u.pathname.includes("/invite/"));
  check("the admin is signed in under /admin", path(admin).startsWith("/admin"), "/admin...", admin.url());

  step("Admin creates a rep");
  // 3. The admin creates the rep.
  await goto(admin, "/admin/users");
  await admin.fill('input[name="name"]', "Pilot Rep");
  await admin.fill('input[name="login"]', "pilot.rep");
  await admin.locator('form:has(input[name="login"]) button[type="submit"]').click();
  const repInvite = await inviteIn(admin);
  check("the rep invite is an /invite link", /^\/invite\//.test(repInvite), "/invite/<token>", repInvite);
  has("the rep is listed", await body(admin), "pilot.rep");

  step("Admin adds two lines");
  // 4. Two lines: cans in cases, food in value.
  await goto(admin, "/admin/lines");
  const addLine = async (nameAr, code, unit) => {
    const form = admin.locator('form:has(input[name="code"])').first();
    await form.locator('input[name="nameAr"]').fill(nameAr);
    await form.locator('input[name="code"]').fill(code);
    if (unit) await form.locator('select[name="unit"]').selectOption(unit);
    await form.locator('button[type="submit"]').click();
    await admin.locator('[role="status"]', { hasText: copy("admin.lines.saved") }).first().waitFor({ timeout: 20000 });
  };
  await addLine("علب اختبار", "cans", "cases");
  await addLine("أغذية اختبار", "food", "value");
  await goto(admin, "/admin/lines");
  const lineText = await body(admin);
  has("the cans line is listed", lineText, "علب اختبار");
  has("the food line is listed", lineText, "أغذية اختبار");

  step("Admin sets November targets");
  // 5. November targets for the rep.
  await goto(admin, "/admin/targets?ym=2026-11");
  await admin.locator('input[name^="c:"][name$="-cans"]').fill("1000");
  await admin.locator('input[name^="c:"][name$="-food"]').fill("50000");
  await admin.locator('form:has(input[name="ym"]) button[type="submit"]').click();
  await admin.locator('[role="status"]', { hasText: /\d|واحد|تارجتين/ }).first().waitFor({ timeout: 20000 });
  await goto(admin, "/admin/targets?ym=2026-11");
  const cans = await admin.locator('input[name^="c:"][name$="-cans"]').inputValue();
  const food = await admin.locator('input[name^="c:"][name$="-food"]').inputValue();
  check("the cans target was stored", /^1,?000$/.test(cans), "1000", cans);
  check("the food target was stored", /^50,?000/.test(food), "50000", food);

  step("Admin publishes the scheme");
  // 6. The scheme editor: one "line tiers" card on cans, then publish.
  await goto(admin, "/admin/schemes?ym=2026-11");
  await admin.getByRole("button", { name: copy("admin.schemes.add.button") }).click();
  await admin.locator("#preset-menu").getByRole("button", { name: copy("admin.schemes.presets.tiers.name"), exact: false }).first().click();
  const card = admin.locator('section[id^="card-"]').first();
  await card.locator('input[id$="-label-ar"]').fill("شرائح علب اختبار");
  await card.locator('select[id$="-line"]').selectOption({ label: "علب اختبار" });
  await card.locator('input[id$="-tier-0-from"]').fill("90");
  await card.locator('input[id$="-tier-0-pay"]').fill("111");
  await card.getByRole("button", { name: copy("admin.schemes.card.tiers.add") }).click();
  await card.locator('input[id$="-tier-1-from"]').fill("100");
  await card.locator('input[id$="-tier-1-pay"]').fill("222");
  await admin.getByRole("button", { name: copy("admin.schemes.publish.button"), exact: true }).click();
  await admin.locator("dialog[open]").getByRole("button", { name: copy("admin.schemes.confirm.confirm"), exact: true }).click();
  const published = copy("admin.schemes.publish.done").split("{version}")[0];
  await admin.locator('[role="status"]', { hasText: published.trim() }).first().waitFor({ timeout: 20000 });
  await goto(admin, "/admin/schemes?ym=2026-11");
  const status = await admin.locator('[data-testid="scheme-status"]').innerText();
  const publishedPrefix = copy("admin.schemes.status.published").replace("{version}", "1");
check("the scheme shows as published, version 1", status.startsWith(publishedPrefix), `text starting "${publishedPrefix}"`, status);

  step("Rep reads the commission screen");
  // 7. The rep opens his invite in a second context, sets a PIN and reads the commission screen.
  const rep = await newPage({ width: 390, height: 844 });
  await goto(rep, repInvite);
  await rep.fill('input[name="pin"]', PIN);
  await rep.fill('input[name="confirm"]', PIN);
  await submitToUrl(rep, 'input[name="confirm"]', /\/app$/);
  check("the rep lands on /app", path(rep) === "/app", "/app", rep.url());
  await goto(rep, "/app/commission");
  const text = await body(rep);
  has("the commission screen names the card", text, "علب اختبار");
  for (const figure of ["111", "222"]) hasToken(`the tier table shows ${figure}`, text, figure);
  // Each step pays its own amount: the pair sits in one cell of the tier table.
  const cells = await rep.locator("section[aria-label] li").allInnerTexts();
  for (const [pct, pay] of [["90", "111"], ["100", "222"]]) {
    const cell = cells.find((c) => c.startsWith(copy("commission.tierFrom").replace("{pct}", pct)));
    check(`the ${pct}% step pays ${pay}`, cell !== undefined && containsToken(cell, pay), `a cell with "${pct}%" and ${pay}`, JSON.stringify(cells));
  }

  // ---- The demo company: overview, coverage, Excel upload, incentive, isolation, roles. ----
  const invites = [...seedOut.matchAll(/\/invite\/\S+/g)].map((m) => m[0]);
  if (invites.length < 3) fail(`expected three invite paths in the seed output, found: ${seedOut}`);
  const [ahmedInvite, , samiInvite] = invites;

  step("Demo admin: overview order");
  const demo = await newPage();
  await goto(demo, "/admin/signin");
  await demo.fill('input[name="email"]', DEMO_ADMIN.email);
  await demo.fill('input[name="password"]', DEMO_ADMIN.password);
  await submitToUrl(demo, 'input[name="email"]', (u) => u.pathname.startsWith("/admin") && !u.pathname.includes("signin"));
  await goto(demo, "/admin");
  const names = (await demo.locator("table tbody tr th[scope='row']").allInnerTexts()).map((n) => n.trim());
  check("the overview lists the four reps", names.length === 4, "4 rows", JSON.stringify(names));
  check("the overview puts يوسف first", names[0]?.startsWith("يوسف"), "يوسف first", JSON.stringify(names));
  check("the overview puts خالد last", names[3]?.startsWith("خالد"), "خالد last", JSON.stringify(names));

  step("Demo admin: a coverage line");
  await goto(demo, "/admin/lines");
  {
    const form = demo.locator('form:has(input[name="code"])').first();
    await form.locator('input[name="nameAr"]').fill("تغطية العملاء");
    await form.locator('input[name="code"]').fill("cov");
    await form.locator('select[name="kind"]').selectOption("coverage");
    await form.locator('select[name="unit"]').selectOption("outlets");
    await form.locator('button[type="submit"]').click();
    await demo.locator('[role="status"]', { hasText: copy("admin.lines.saved") }).first().waitFor({ timeout: 20000 });
  }
  await goto(demo, "/admin/lines");
  has("the coverage line is listed", await body(demo), "تغطية العملاء");

  step("Demo admin: coverage has no monthly target of its own");
  // The 120 is the territory total the supervisor records with each update, not a target-grid cell.
  await goto(demo, "/admin/targets?ym=2026-11");
  const covCells = await demo.locator('input[name^="c:"][name$="-cov"]').count();
  check("the targets grid has no coverage column", covCells === 0, "0 inputs", covCells);

  step("Demo admin: daily Excel upload through the real upload card");
  const xlsxPath = join(dataRoot, "daily.xlsx");
  {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("daily");
    ws.addRow(["login", "date", "line", "amount"]);
    ws.addRow(["ahmed", "2026-11-12", "bev", 120]);
    ws.addRow(["ahmed", "2026-11-14", "bev", 50]);
    await wb.xlsx.writeFile(xlsxPath);
  }
  await goto(demo, "/admin/uploads");
  {
    const [chooser] = await Promise.all([demo.waitForEvent("filechooser"), demo.locator("#file-daily").click()]);
    await chooser.setFiles(xlsxPath);
    await demo.locator('form:has(#file-daily) button[type="submit"]').click();
    await demo.locator('[aria-live="polite"]', { hasText: "اتطبّق" }).first().waitFor({ timeout: 30000 });
  }
  has("the upload reports the rows as applied", await body(demo), "اتطبّق");
  await goto(demo, "/admin/uploads");
  has("the recent uploads list shows the file", await body(demo), copy("admin.uploads.recent.status.applied"));

  step("Isolation: the other company never shows");
  await goto(demo, "/admin/users");
  let usersText = await body(demo);
  has("the users page lists the company's own rep", usersText, "ahmed");
  check("the users page has no other-rep", !/other-rep|Other Rep/i.test(usersText), "no other-rep", squash(usersText));
  await goto(demo, "/admin/users?edit=other-rep");
  usersText = await body(demo);
  check("?edit=other-rep shows nothing of it", !/other-rep|Other Rep/i.test(usersText), "no other-rep", squash(usersText));

  step("Supervisor Sami: PIN sign-in and coverage");
  let sami = await newPage({ width: 390, height: 844 });
  await goto(sami, samiInvite);
  await sami.fill('input[name="pin"]', PIN);
  await sami.fill('input[name="confirm"]', PIN);
  await submitToUrl(sami, 'input[name="confirm"]', /\/app$/);
  // A fresh browser signs in with the login and the PIN just chosen.
  const samiAgain = await newPage({ width: 390, height: 844 });
  await goto(samiAgain, "/signin");
  await samiAgain.fill('input[name="login"]', "sami");
  await samiAgain.fill('input[name="pin"]', PIN);
  await submitToUrl(samiAgain, 'input[name="pin"]', /\/app$/);
  check("Sami signs in with login and PIN", path(samiAgain) === "/app", "/app", samiAgain.url());
  await sami.close();
  sami = samiAgain;
  await goto(sami, "/app/team");
  check("the supervisor sees /app/team", path(sami) === "/app/team", "/app/team", sami.url());
  {
    const form = sami.locator('section[aria-label="أحمد"] form');
    await form.locator('input[name="covered"]').fill("60");
    await form.locator('input[name="total"]').fill("120");
    await form.locator('button[type="submit"]').click();
    await form.locator('[role="status"]', { hasText: copy("coverage.form.saved") }).waitFor({ timeout: 20000 });
  }
  has("Sami's team page now reads 60 من 120", await body(sami), "60 من 120");

  step("Rep Ahmed: invite, PIN, sign-in");
  const ahmed = await newPage({ width: 390, height: 844 });
  await goto(ahmed, ahmedInvite);
  await ahmed.fill('input[name="pin"]', PIN);
  await ahmed.fill('input[name="confirm"]', PIN);
  await submitToUrl(ahmed, 'input[name="confirm"]', /\/app$/);
  check("Ahmed lands on /app", path(ahmed) === "/app", "/app", ahmed.url());
  await goto(ahmed, "/app");
  const noBadge = ahmed.locator('a[href="/app/notifications"] span');
  check("Ahmed has no unread notification yet", (await noBadge.count()) === 0, "no badge", await noBadge.count());

  step("Demo admin: an incentive");
  const INCENTIVE = { label: "حافز اختبار الكولا", explanation: "بيع من الكولا وخد الحافز دة" };
  await goto(demo, "/admin/incentives?ym=2026-11");
  {
    const form = demo.locator('form:has(input[name="expectedVersion"])');
    await form.locator('input[name="label"]').fill(INCENTIVE.label);
    await form.locator('textarea[name="explanation"]').fill(INCENTIVE.explanation);
    await form.locator('input[name="amount"]').fill("500");
    await form.locator('input[name="mode"][value="focus"]').check();
    await form.locator('input[name="focusMin"]').fill("100");
    await form.locator('button[type="submit"]').click();
    await demo.getByText(INCENTIVE.label).first().waitFor({ timeout: 20000 });
  }
  has("the incentive is listed for the admin", await body(demo), INCENTIVE.label);

  step("Rep Ahmed: bell, notification, coverage tab, close form");
  await goto(ahmed, "/app");
  const bell = ahmed.locator('a[href="/app/notifications"]');
  check("the bell shows 1", (await bell.innerText()).trim() === "1", "1", await bell.innerText());
  const unreadOne = copy("home.notificationsUnread").match(/one \{([^}]*)\}/)?.[1];
  check("the bell's label reads one new notification", ((await bell.getAttribute("aria-label")) ?? "").endsWith(unreadOne), unreadOne, await bell.getAttribute("aria-label"));
  await bell.click();
  await ahmed.waitForURL(/\/app\/notifications$/);
  const notes = await body(ahmed);
  has("the notification carries the incentive's name", notes, INCENTIVE.label);
  has("the notification carries its explanation", notes, INCENTIVE.explanation);
  has("the notification is marked as an incentive", notes, copy("notifications.kind.incentive"));
  await goto(ahmed, "/app");
  check("the bell is clear after reading", (await ahmed.locator('a[href="/app/notifications"] span').count()) === 0, "no badge", "badge present");

  await Promise.all([ahmed.waitForURL(/line=/), ahmed.locator("nav a", { hasText: "تغطية العملاء" }).click()]);
  const cov = await body(ahmed);
  has("the coverage tab reads 60 من 120", cov, "60 من 120");

  await goto(ahmed, "/app/close?date=2026-11-12");
  const closed12 = await body(ahmed);
  const adminNote = copy("close.adminNote").replace("{amount}", "120");
  has("the 12 Nov close form shows the admin's 120", closed12, adminNote);
  await goto(ahmed, "/app/close?date=2026-11-14");
  has("the 14 Nov close form shows the admin's 50", await body(ahmed), copy("close.adminNote").replace("{amount}", "50"));
  // Collections is a line field (line.coll) here: this company has a collection line.
  for (const name of ["cashSales", "creditSales", "expenses", "loaded", "sold", "returned"]) {
    const field = ahmed.locator(`input[name="${name}"]`);
    check(`the draft close leaves ${name} blank`, (await field.count()) === 1 && (await field.inputValue()) === "", "one empty input", `${await field.count()} / ${await field.count() ? await field.inputValue() : ""}`);
  }

  step("Roles: a rep is kept out of supervisor and admin pages");
  await goto(ahmed, "/app/team");
  check("a rep is redirected away from /app/team", path(ahmed) !== "/app/team", "not /app/team", ahmed.url());
  const tpl = await ahmed.request.get(`${base}/admin/uploads/template/daily`, { maxRedirects: 0 });
  const tplType = tpl.headers()["content-type"] ?? "";
  check("a rep session gets no template file", tpl.status() >= 300 && !tplType.includes("spreadsheet"), "a redirect, no xlsx", `${tpl.status()} ${tplType}`);
  await goto(ahmed, "/admin/users");
  check("a rep session cannot read /admin/users", path(ahmed) !== "/admin/users", "redirected away", ahmed.url());
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

// A signal stops the run with the conventional 128 + signal number (SIGINT 130, SIGTERM 143).
let stopping = false;
for (const [sig, code] of [["SIGINT", 130], ["SIGTERM", 143]]) {
  process.on(sig, () => {
    if (stopping) return; // a second signal while cleaning up must not start a second cleanup
    stopping = true;
    console.error(`\n${sig}: cleaning up`);
    cleanup().finally(() => process.exit(code));
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
