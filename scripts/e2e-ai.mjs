// End-to-end check of the AI features with the FAKE provider: temporary local database and photo
// folder, demo seed, production build, then the rep's close by photo and by voice, return photos
// and who may open them, the assistant, and the admin's switch and usage.
// Usage: pnpm e2e:ai   (builds first; takes a few minutes). The developer's .data directory is never touched.
//   E2E_AI_SKIP_BUILD=1 pnpm e2e:ai   reuses the last build (for iterating on this script only).
//
// Nothing here may leave the machine: the browser contexts abort every request that is not for the
// local server and the run fails if there was one. The server has no provider key in its environment
// and AI_PROVIDER=fake, so it has nothing to call out with either.
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import ExcelJS from "exceljs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

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
/** A report date as the draft banner shows it: day and month in Arabic, Western digits. */
const shownDate = (iso) => new Intl.DateTimeFormat("ar-EG-u-nu-latn", { day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
const copy = (key) => {
  const v = key.split(".").reduce((a, k) => a?.[k], catalogue);
  if (typeof v !== "string") throw new Error(`Missing catalogue key ${key}`);
  return v;
};

const FIXTURE_640 = fileURLToPath(new URL("./fixtures/report-640.jpg", import.meta.url));
const FIXTURE_641 = fileURLToPath(new URL("./fixtures/report-641.jpg", import.meta.url));

// Local-only sample credentials of the demo seed (see src/db/seed.ts); never a real database.
const DEMO_ADMIN = { email: "admin@demo.test", password: "demo-admin-2026" };
const PIN = "482915";
const TODAY = "2026-11-14";
const checks = [];
let server;
let serverExited = false;
let serverError;
let browser;
let dataRoot;
/** What the server printed, so a failed background job (retention) cannot go unnoticed. */
let serverLog = "";
/** Requests the browser tried to send to any host other than the local server. */
const leaks = [];

function fail(msg) {
  throw new Error(msg);
}
function check(name, ok, expected, found) {
  if (!ok) fail(`FAIL ${name}\n  expected: ${expected}\n  found:    ${String(found).slice(0, 400)}`);
  checks.push(name);
  console.log(`ok   ${name}`);
}
const step = (title) => console.log(`\n== ${title}`);
const squash = (text) => text.replace(/\s+/g, " ");
const has = (name, text, needle) => check(name, text.includes(needle), `text containing "${needle}"`, squash(text));
const lacks = (name, text, needle) => check(name, !text.includes(needle), `text without "${needle}"`, squash(text));

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
  dataRoot = mkdtempSync(join(tmpdir(), "salesman-e2e-ai-"));
  const env = {
    APP_TODAY: TODAY,
    ALLOW_APP_TODAY: "1",
    ALLOW_LOCAL_DB: "1",
    PGLITE_DIR: join(dataRoot, "pglite"),
    // Private photos on a throwaway local disk, and the offline fake provider (R63).
    ALLOW_LOCAL_FILES: "1",
    FILES_DIR: join(dataRoot, "files"),
    AI_PROVIDER: "fake",
    ALLOW_AI_FAKE: "1",
  };
  // Whatever the developer's shell holds, this run has no database URL, no provider key and no kill switch.
  for (const name of ["DATABASE_URL", "GEMINI_API_KEY", "GROQ_API_KEY", "OPENROUTER_API_KEY", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_URL", "AI_DISABLED", "STORAGE_DRIVER"]) {
    delete process.env[name];
  }

  if (process.env.E2E_AI_SKIP_BUILD !== "1") {
    console.log("Building...");
    run("pnpm", ["build"]);
  }
  const seedOut = run("pnpm", ["db:seed"], env);
  const invites = [...seedOut.matchAll(/\/invite\/\S+/g)].map((m) => m[0]);
  if (invites.length < 3) fail(`expected three invite paths in the seed output, found: ${seedOut}`);
  const [ahmedInvite, otherInvite] = invites;

  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const localHost = `127.0.0.1:${port}`;
  server = spawn("node_modules/.bin/next", ["start", "-p", String(port), "-H", "127.0.0.1"], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...env, NODE_ENV: "production" },
  });
  for (const stream of [server.stdout, server.stderr]) {
    stream.on("data", (chunk) => {
      const text = String(chunk);
      serverLog = (serverLog + text).slice(-20000);
      process.stderr.write(text);
    });
  }
  server.once("error", (e) => {
    // A failed spawn never emits "exit": mark the server gone so cleanup does not wait for it.
    serverError = e;
    serverExited = true;
  });
  server.once("exit", () => {
    serverExited = true;
  });
  await waitForServer(base);

  browser = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });

  /** A browser context whose every request is checked: only the local server is reachable. */
  const newContext = async (viewport) => {
    const context = await browser.newContext({ viewport, permissions: ["microphone"] });
    await context.route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (url.protocol === "data:" || url.protocol === "blob:" || url.protocol === "about:" || url.host === localHost) return route.continue();
      leaks.push(route.request().url());
      return route.abort();
    });
    return context;
  };
  const newPage = async (viewport = { width: 390, height: 844 }) => {
    const page = await (await newContext(viewport)).newPage();
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (url.protocol.startsWith("http") && url.host !== localHost && !leaks.includes(request.url())) leaks.push(request.url());
    });
    return page;
  };
  // Direction isolates around dates and numbers are invisible; the checks read the text without them.
  const plain = (s) => s.replace(/[\u2066-\u2069\u200e\u200f]/g, "");
  const body = async (page) => plain(await page.locator("body").innerText());
  const path = (page) => new URL(page.url()).pathname;
  const goto = (page, p) => page.goto(`${base}${p}`, { waitUntil: "load" });
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
  const acceptInvite = async (page, invite) => {
    await goto(page, invite);
    await page.fill('input[name="pin"]', PIN);
    await page.fill('input[name="confirm"]', PIN);
    await submitToUrl(page, 'input[name="confirm"]', /\/app$/);
  };
  /** GET `path` from inside the page (its cookies, as the browser would send them); the cookie is Secure, which an out-of-page request would not send over http. */
  const fetched = (page, path) =>
    page.evaluate(async (p) => {
      const res = await fetch(p, { credentials: "same-origin", cache: "no-store" });
      return { status: res.status, type: res.headers.get("content-type") ?? "" };
    }, path);
  const value = (page, name) => page.locator(`input[name="${name}"]`).inputValue();

  // The guard must be able to fail: a request to another host is aborted and recorded, then forgotten.
  {
    const probe = await newPage();
    await goto(probe, "/signin");
    const reached = await probe.evaluate(() => fetch("http://leak-probe.invalid/ping", { mode: "no-cors" }).then(() => true, () => false));
    check("the network guard blocks and records a request to another host", reached === false && leaks.some((u) => u.includes("leak-probe.invalid")), "an aborted request, recorded", JSON.stringify({ reached, leaks }));
    leaks.length = 0;
    await probe.context().close();
  }

  // ---- The admin switches the AI on for the demo company. ----
  step("Demo admin: the demo company has AI on (the seed does it; other-co stays off)");
  const demo = await newPage({ width: 1440, height: 1000 });
  await goto(demo, "/admin/signin");
  await demo.fill('input[name="email"]', DEMO_ADMIN.email);
  await demo.fill('input[name="password"]', DEMO_ADMIN.password);
  await submitToUrl(demo, 'input[name="email"]', (u) => u.pathname.startsWith("/admin") && !u.pathname.includes("signin"));
  const setAi = async (on) => {
    await goto(demo, "/admin/ai");
    if (on) {
      await demo.getByRole("button", { name: copy("admin.ai.turnOn"), exact: true }).click();
      await demo.locator("dialog[open]").getByRole("button", { name: copy("admin.ai.confirm.confirm"), exact: true }).click();
    } else {
      await demo.getByRole("button", { name: copy("admin.ai.turnOff"), exact: true }).click();
    }
    await demo.getByText(copy(on ? "admin.ai.stateOn" : "admin.ai.stateOff"), { exact: false }).first().waitFor({ timeout: 20000 });
  };
  await goto(demo, "/admin/ai");
  has("the demo company has AI on", await body(demo), copy("admin.ai.stateOn"));

  // ---- Step 1: Ahmed, the notice, declining. ----
  step("1. Ahmed: the notice, declined");
  const ahmed = await newPage();
  const aiRequests = [];
  ahmed.on("request", (r) => {
    if (new URL(r.url()).pathname.startsWith("/app/ai/")) aiRequests.push(r.url());
  });
  await acceptInvite(ahmed, ahmedInvite);
  check("Ahmed lands on /app", path(ahmed) === "/app", "/app", ahmed.url());
  await goto(ahmed, "/app/close");
  const methods = ahmed.getByRole("group", { name: copy("close.methodLabel") });
  const photoButton = methods.getByRole("button", { name: copy("close.methodPhoto") });
  const voiceButton = methods.getByRole("button", { name: copy("close.methodVoice") });
  const typeButton = methods.getByRole("button", { name: copy("close.methodType") });
  await photoButton.click();
  const sheet = ahmed.locator("dialog[open]");
  await sheet.waitFor({ timeout: 10000 });
  has("the notice appears", await sheet.innerText(), copy("ai.notice.title"));
  await sheet.getByRole("button", { name: copy("ai.notice.decline") }).click();
  await ahmed.locator("dialog[open]").waitFor({ state: "detached", timeout: 10000 });
  check("typing stays selected after declining", (await typeButton.getAttribute("aria-pressed")) === "true", "aria-pressed true", await typeButton.getAttribute("aria-pressed"));
  check("the cash field is usable", await ahmed.locator('input[name="cashSales"]').isEditable(), "an editable input", "not editable");
  check("declining made no request to /app/ai/*", aiRequests.length === 0, "no AI request", JSON.stringify(aiRequests));

  // ---- Step 2: accept, read the 641 sample (dated 12 November, most fields unreadable). ----
  step("2. Ahmed: accepts, reads report-641 (dated 12 November)");
  await goto(ahmed, "/app/close");
  await photoButton.click();
  await ahmed.locator("dialog[open]").getByRole("button", { name: copy("ai.notice.accept") }).click();
  await ahmed.locator("dialog[open]").waitFor({ state: "detached", timeout: 20000 });
  await ahmed.waitForLoadState("networkidle");
  const choose = async (file) => {
    const [chooser] = await Promise.all([ahmed.waitForEvent("filechooser", { timeout: 15000 }), photoButton.click()]);
    await chooser.setFiles(file);
    await ahmed.locator('input[name="draftId"]').waitFor({ state: "attached", timeout: 30000 });
  };
  await choose(FIXTURE_641);
  check("the photo went to /app/ai/close-photo", aiRequests.some((u) => u.endsWith("/app/ai/close-photo")), "a request to /app/ai/close-photo", JSON.stringify(aiRequests));
  check("beverages reads 118", (await value(ahmed, "line.bev")) === "118", "118", await value(ahmed, "line.bev"));
  check("cash sales reads 14800 (ungrouped; R30)", (await value(ahmed, "cashSales")) === "14800", "14800", await value(ahmed, "cashSales"));
  check("food was not read", (await value(ahmed, "line.food")) === "", "empty", await value(ahmed, "line.food"));
  check("collection was not read", (await value(ahmed, "line.coll")) === "", "empty", await value(ahmed, "line.coll"));
  let text = await body(ahmed);
  has("the page says what could not be read", text, copy("close.draft.notRead"));
  has("the banner says the report is dated 12 November", text, copy("close.draft.dateMismatch").replace("{date}", shownDate("2026-11-12")));
  const submit = ahmed.locator('form button[type="submit"]');
  check("confirm is disabled until the date is acknowledged", await submit.isDisabled(), "disabled", "enabled");
  await ahmed.getByRole("button", { name: copy("close.draft.dateOk") }).click();
  // Every field the reader was unsure of must be acknowledged too before confirm opens (adaptation: R79).
  for (let i = 0; i < 12 && (await ahmed.locator('[data-ack="pending"]').count()) > 0; i++) await ahmed.locator('[data-ack="pending"]').first().click();
  await submit.waitFor({ state: "visible" });
  check("confirm is enabled once the date and the doubtful fields are acknowledged", await submit.isEnabled(), "enabled", "disabled");
  await submit.click();
  await ahmed.getByText(copy("close.fixErrors")).first().waitFor({ timeout: 20000 });
  text = await body(ahmed);
  has("confirm reports the empty fields as required", text, copy("close.errors.required"));
  check("nothing was saved: still on the close page", path(ahmed) === "/app/close", "/app/close", ahmed.url());
  const homeTab = await newPage();
  // A second tab of the same session: the day is still not recorded.
  await homeTab.context().addCookies(await ahmed.context().cookies());
  await goto(homeTab, "/app");
  lacks("the home screen still shows the day as not recorded", await body(homeTab), copy("home.doneTitle"));
  has("the home screen still shows beverages at 1,140", await body(homeTab), "1,140");
  await ahmed.getByRole("button", { name: copy("close.draft.clear") }).click();
  await ahmed.locator('input[name="draftId"]').waitFor({ state: "detached", timeout: 10000 });
  check("clearing the reading empties beverages", (await value(ahmed, "line.bev")) === "", "empty", await value(ahmed, "line.bev"));
  check("clearing the reading empties cash sales", (await value(ahmed, "cashSales")) === "", "empty", await value(ahmed, "cashSales"));

  // ---- Step 3: the 640 sample (dated today), a clean read. ----
  step("3. Ahmed: reads report-640 (dated today)");
  await choose(FIXTURE_640);
  for (const [name, expected] of [["line.bev", "118"], ["line.food", "7900"], ["line.coll", "19500"], ["cashSales", "14800"], ["creditSales", "3200"], ["expenses", "150"]]) {
    check(`${name} reads ${expected}`, (await value(ahmed, name)) === expected, expected, await value(ahmed, name));
  }
  text = await body(ahmed);
  has("the reconciliation shows 34,150", text, "34,150");
  has("the reconciliation shows 45", text, "45");
  lacks("no date warning for a report dated today", text, copy("close.draft.dateMismatch").split("{date}")[0]);
  const ackCredit = ahmed.getByRole("button", { name: copy("close.draft.okFor").replace("{label}", copy("close.creditSales")) });
  check("credit sales is the one flagged field", (await ahmed.locator('[data-ack="pending"]').count()) === 1 && (await ackCredit.count()) === 1, "one acknowledgement button, for credit sales", await ahmed.locator('[data-ack="pending"]').count());
  await goto(homeTab, "/app");
  lacks("the home screen still shows the day as not recorded", await body(homeTab), copy("home.doneTitle"));
  await ahmed.reload({ waitUntil: "load" });
  await ahmed.locator('input[name="draftId"]').waitFor({ state: "attached", timeout: 15000 });
  check("a reload keeps the values", (await value(ahmed, "line.food")) === "7900", "7900", await value(ahmed, "line.food"));

  // ---- Step 4: acknowledge the flagged field, confirm. ----
  step("4. Ahmed: acknowledges the flagged field and confirms");
  check("confirm is disabled while a flagged field is unacknowledged", await submit.isDisabled(), "disabled", "enabled");
  await ackCredit.click();
  check("confirm is enabled after the acknowledgement", await submit.isEnabled(), "enabled", "disabled");
  await Promise.all([ahmed.waitForURL(/\/app$/, { timeout: 20000 }), submit.click()]);
  await ahmed.waitForLoadState("load");
  text = await body(ahmed);
  has("home shows the day recorded", text, copy("home.doneTitle"));
  has("home shows beverages achieved 1,258", text, "1,258");

  // ---- Step 5: an admin-recorded line is not overwritten by a photo. ----
  step("5. A day with an admin-recorded line");
  const xlsxPath = join(dataRoot, "daily.xlsx");
  {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("daily");
    ws.addRow(["login", "date", "line", "amount"]);
    ws.addRow(["ahmed", "2026-11-11", "bev", 120]);
    await wb.xlsx.writeFile(xlsxPath);
  }
  await goto(demo, "/admin/uploads");
  {
    const [chooser] = await Promise.all([demo.waitForEvent("filechooser"), demo.locator("#file-daily").click()]);
    await chooser.setFiles(xlsxPath);
    await demo.locator('form:has(#file-daily) button[type="submit"]').click();
    await demo.locator('[aria-live="polite"]', { hasText: copy("admin.uploads.recent.status.applied") }).first().waitFor({ timeout: 30000 });
  }
  await goto(ahmed, "/app");
  has("home shows beverages 1,294 after the upload replaced 84 with 120", await body(ahmed), "1,294");
  await goto(ahmed, "/app/close?date=2026-11-11");
  const adminNote = copy("close.adminNote").replace("{amount}", "120");
  has("the 11 November form shows the admin's 120", await body(ahmed), adminNote);
  await choose(FIXTURE_640);
  text = await body(ahmed);
  has("the admin's note is still there after the photo fill", text, adminNote);
  has("the photo's own beverages figure is shown beside it, not applied", text, copy("close.draft.photoRead").replace("{amount}", "118 كرتونة"));
  has("the report date (today) differs from the day being closed", text, copy("close.draft.dateMismatch").replace("{date}", shownDate(TODAY)));
  await ahmed.getByRole("button", { name: copy("close.draft.dateOk") }).click();
  for (let i = 0; i < 12 && (await ahmed.locator('[data-ack="pending"]').count()) > 0; i++) await ahmed.locator('[data-ack="pending"]').first().click();
  await Promise.all([ahmed.waitForURL(/\/app$/, { timeout: 20000 }), submit.click()]);
  await ahmed.waitForLoadState("load");
  has("home still shows beverages 1,294 (the admin's 120 stayed)", await body(ahmed), "1,294");
  await goto(ahmed, "/app/close?date=2026-11-11");
  has("the saved day still shows the admin's 120", await body(ahmed), adminNote);

  // ---- Step 6: voice (fake microphone). ----
  step("6. Ahmed: a voice note on 10 November");
  await goto(ahmed, "/app/close?date=2026-11-10");
  await voiceButton.click();
  await ahmed.getByRole("button", { name: copy("close.voice.start") }).click();
  await ahmed.getByRole("button", { name: copy("close.voice.stop") }).waitFor({ timeout: 10000 });
  await ahmed.waitForTimeout(2000);
  await ahmed.getByRole("button", { name: copy("close.voice.stop") }).click();
  await ahmed.locator('input[name="draftId"]').waitFor({ state: "attached", timeout: 30000 });
  text = await body(ahmed);
  has("the transcript is shown", text, "مشروبات مية وعشرين كرتونة");
  for (const [name, expected] of [["line.bev", "120"], ["line.food", "8250"], ["line.coll", "20000"], ["cashSales", "5500"]]) {
    check(`voice: ${name} reads ${expected}`, (await value(ahmed, name)) === expected, expected, await value(ahmed, name));
  }
  lacks("a recording that ended normally is not reported as cut", text, copy("close.draft.cutLimit"));
  check("the voice note went to /app/ai/close-voice", aiRequests.some((u) => u.endsWith("/app/ai/close-voice")), "a request to /app/ai/close-voice", JSON.stringify(aiRequests));
  // ---- Step 6b: a recording cut short (the page is hidden) keeps its audio and flags the last number. ----
  step("6b. Ahmed: a recording cut short is kept and its last number is flagged");
  await goto(ahmed, "/app/close?date=2026-11-10");
  await voiceButton.click();
  await ahmed.getByRole("button", { name: copy("close.voice.start") }).click();
  await ahmed.getByRole("button", { name: copy("close.voice.stop") }).waitFor({ timeout: 10000 });
  await ahmed.waitForTimeout(1500);
  await ahmed.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  const sendKept = ahmed.getByRole("button", { name: copy("close.voice.sendKept") });
  await sendKept.waitFor({ timeout: 10000 });
  has("the cut recording says why it stopped", await body(ahmed), copy("close.voice.hiddenStopped"));
  await ahmed.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
  });
  await sendKept.click();
  await ahmed.locator('input[name="draftId"]').waitFor({ state: "attached", timeout: 30000 });
  await ahmed.getByText(copy("close.draft.listening")).waitFor({ state: "detached", timeout: 30000 });
  text = await body(ahmed);
  has("the banner says the recording was cut", text, copy("close.draft.cutHidden"));
  check("the last number (cash sales) is flagged for checking", (await ahmed.getByRole("button", { name: copy("close.draft.okFor").replace("{label}", copy("close.cashSales")) }).count()) === 1, "an acknowledgement button for cash sales", await ahmed.locator('[data-ack="pending"]').count());

  // ---- Step 7: a return with a photo, and who may open it. ----
  step("7. Returns: a photo, saved, and who may open it");
  await goto(ahmed, `/app/close?date=${TODAY}`);
  if ((await value(ahmed, "cashSales")) === "") await ahmed.fill('input[name="cashSales"]', "14800");
  await ahmed.getByRole("button", { name: copy("close.returnsAdd") }).click();
  await ahmed.fill('input[name="ret.0.description"]', "علب كولا تالفة");
  await ahmed.fill('input[name="ret.0.quantity"]', "2");
  await ahmed.locator('input[type="file"][capture]').setInputFiles(FIXTURE_640);
  await ahmed.locator('img[src^="/files/"]').first().waitFor({ timeout: 30000 });
  await Promise.all([ahmed.waitForURL(/\/app$/, { timeout: 20000 }), submit.click()]);
  await ahmed.waitForLoadState("load");
  await goto(ahmed, `/app/close?date=${TODAY}`);
  const thumb = ahmed.locator('img[src^="/files/"]').first();
  await thumb.waitFor({ timeout: 20000 });
  const photoPath = await thumb.getAttribute("src");
  check("the saved return shows its photo", /^\/files\/[0-9a-f]{32}$/.test(photoPath ?? ""), "/files/<id>", photoPath);
  await ahmed.waitForFunction((src) => {
    const img = document.querySelector(`img[src="${src}"]`);
    return img instanceof HTMLImageElement && img.complete && img.naturalWidth > 0;
  }, photoPath, { timeout: 20000 });
  const own = await fetched(ahmed, photoPath);
  check("Ahmed's thumbnail loads (status 200, an image)", own.status === 200 && own.type.startsWith("image/"), "200 image/*", `${own.status} ${own.type}`);

  // Khaled is a supervisor of the demo company, but not Ahmed's: the admin issues him an invite first.
  await goto(demo, "/admin/users");
  await demo.locator("tr", { has: demo.locator("th", { hasText: "خالد" }) }).getByRole("button", { name: copy("admin.users.actions.newLink") }).click();
  const khaledInvite = await inviteIn(demo);
  const khaled = await newPage();
  await acceptInvite(khaled, khaledInvite);
  const khaledGet = await fetched(khaled, photoPath);
  check("a colleague who is not his supervisor gets 404", khaledGet.status === 404, "404", khaledGet.status);
  const other = await newPage();
  await acceptInvite(other, otherInvite);
  const otherGet = await fetched(other, photoPath);
  check("the other company's rep gets 404 (R42)", otherGet.status === 404, "404", otherGet.status);
  const adminGet = await fetched(demo, photoPath);
  check("the demo admin gets 200", adminGet.status === 200, "200", adminGet.status);
  const visitor = await newPage();
  await goto(visitor, "/signin");
  const anonymous = await fetched(visitor, photoPath);
  check("a signed-out request gets 404", anonymous.status === 404, "404", anonymous.status);

  // ---- Step 8: the assistant. ----
  step("8. The assistant");
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
  await goto(ahmed, "/app/assistant");
  const log = ahmed.locator('[role="log"]');
  const bubbles = log.locator(":scope > div");
  /** Waits until the conversation holds `count` bubbles and nothing is pending, then returns the last one's text. */
  const settled = async (count) => {
    await ahmed.waitForFunction((n) => document.querySelectorAll('[role="log"] > div').length >= n, count, { timeout: 30000 });
    await ahmed.getByText(copy("assistant.thinking"), { exact: true }).waitFor({ state: "detached", timeout: 30000 });
    return plain(await bubbles.last().innerText());
  };
  let asked = 0;
  const ask = async (question) => {
    await ahmed.fill("#assistant-ask", question);
    await ahmed.getByRole("button", { name: copy("assistant.send"), exact: true }).click();
    asked += 2;
    return settled(asked);
  };
  const suggestion = ahmed.getByRole("group", { name: copy("assistant.suggest.label") });
  await suggestion.getByRole("button", { name: copy("assistant.suggest.standing") }).click();
  asked += 2;
  let answer = await settled(asked);
  has("the first suggested question names the beverages target 3,000", answer, "3,000");
  answer = await ask("باقي لي كام على تارجت المشروبات؟");
  has("the typed question gives 1,706 (3,000 less the 1,294 achieved)", answer, "1,706");
  await suggestion.getByRole("button", { name: copy("assistant.suggest.policy") }).click();
  asked += 2;
  answer = await settled(asked);
  has("the returns question shows its citation", answer, "سياسة المرتجعات والخصومات · المرتجعات");
  answer = await ask("عمولتي كام؟ [[fake:obey]]");
  has("a reply with an invented figure shows the facts card instead", answer, copy("assistant.verdict.unverified"));
  lacks("the invented 9,999 is nowhere in the answer", answer, "9,999");
  lacks("the invented 9,999 is nowhere on the page", await body(ahmed), "9,999");

  // Explain simply, from the incentive's notification.
  await goto(ahmed, "/app/notifications");
  await Promise.all([ahmed.waitForURL(/\/app\/assistant/, { timeout: 20000 }), ahmed.getByRole("link", { name: copy("notifications.explain") }).first().click()]);
  asked += 2;
  answer = await settled(asked);
  check("the explain answer is not empty", answer.trim().length > 0, "a non-empty answer", answer);
  has("the explain question is the catalogue's", plain(await log.innerText()), copy("assistant.explainQuestion"));
  check("the explain query is removed from the address", !ahmed.url().includes("explain="), "no explain= in the URL", ahmed.url());
  const stored = await bubbles.count();
  // A reload must send no ask: count the page's POSTs until the network is quiet (no fixed wait).
  let postsAfterReload = 0;
  const countPost = (req) => {
    if (req.method() === "POST") postsAfterReload++;
  };
  ahmed.on("request", countPost);
  await ahmed.reload({ waitUntil: "load" });
  await ahmed.waitForLoadState("networkidle");
  ahmed.off("request", countPost);
  check("reloading sends no ask", postsAfterReload === 0, "0 POSTs after the reload", postsAfterReload);
  check("reloading does not ask again", (await bubbles.count()) === stored, `${stored} bubbles`, await bubbles.count());

  // A refused ask (rate limit) keeps the question in the input and stores no rows (R81, R82).
  let refused = false;
  let accepted = stored;
  for (let i = 0; i < 20 && !refused; i++) {
    await ahmed.fill("#assistant-ask", "عمولتي كام؟");
    await ahmed.getByRole("button", { name: copy("assistant.send"), exact: true }).click();
    const notice = ahmed.getByText(copy("assistant.unavailable.rate_limited"), { exact: true });
    const outcome = await Promise.race([
      notice.waitFor({ timeout: 20000 }).then(() => "refused"),
      ahmed.waitForFunction((n) => document.querySelectorAll('[role="log"] > div').length >= n, accepted + 2, { timeout: 20000 }).then(() => "answered"),
    ]);
    if (outcome === "refused") refused = true;
    else {
      accepted += 2;
      await ahmed.getByText(copy("assistant.thinking"), { exact: true }).waitFor({ state: "detached", timeout: 20000 });
    }
  }
  check("the per-minute limit eventually refuses a question", refused, "a rate_limited notice within 20 questions", "never refused");
  check("the refused question is back in the input", (await ahmed.inputValue("#assistant-ask")) === "عمولتي كام؟", "the question text", await ahmed.inputValue("#assistant-ask"));
  check("the refused question left no bubble", (await bubbles.count()) === accepted, `${accepted} bubbles`, await bubbles.count());
  await ahmed.reload({ waitUntil: "load" });
  check("after a reload the refused question stored nothing", (await bubbles.count()) === accepted, `${accepted} stored rows`, await bubbles.count());

  await ahmed.getByRole("button", { name: copy("assistant.clear") }).click();
  await ahmed.getByRole("button", { name: copy("assistant.clearYes"), exact: true }).click();
  // The button goes with the list, so the list is what is waited for.
  await ahmed.waitForFunction(() => document.querySelectorAll('[role="log"] > div').length === 0, undefined, { timeout: 20000 });
  await ahmed.reload({ waitUntil: "load" });
  check("clearing the conversation empties the list", (await bubbles.count()) === 0, "0 bubbles", await bubbles.count());

  // ---- Step 9: the admin's switch. ----
  step("9. Admin: AI off, then on again");
  await setAi(false);
  const beforeOff = aiRequests.length;
  await goto(ahmed, `/app/close?date=${TODAY}`);
  await photoButton.click();
  has("the photo button now shows the unavailable line", await body(ahmed), copy("ai.unavailable.company_off"));
  check("tapping it sent nothing", aiRequests.length === beforeOff, `${beforeOff} AI requests`, aiRequests.length);
  const direct = await ahmed.evaluate(
    async ({ b64, path }) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const form = new FormData();
      form.set("date", path);
      form.set("file", new Blob([bytes], { type: "image/jpeg" }), "report.jpg");
      const res = await fetch("/app/ai/close-photo", { method: "POST", body: form, credentials: "same-origin", headers: { "x-requested-with": "ai" } });
      return { status: res.status, body: await res.json().catch(() => null) };
    },
    { b64: readFileSync(FIXTURE_640).toString("base64"), path: TODAY },
  );
  check("a direct POST to /app/ai/close-photo is refused with company_off", direct.body?.reason === "company_off" && direct.status >= 400, "an error with reason company_off", JSON.stringify(direct));
  await goto(ahmed, "/app/assistant");
  text = await body(ahmed);
  has("the assistant shows its own unavailable line", text, copy("assistant.unavailable.disabled"));
  lacks("and not the close screen's wording", text, copy("ai.unavailable.company_off"));
  await setAi(true);
  await goto(demo, "/admin/ai/usage");
  const meters = await demo.locator('[role="meter"]').evaluateAll((els) => els.map((el) => el.getAttribute("aria-label") ?? ""));
  check("the usage page has three meters", meters.length === 3, "3 meters", JSON.stringify(meters));
  for (const [i, kind] of ["vision", "stt", "chat"].entries()) {
    const used = Number(/\d+/.exec(plain(meters[i]).replace(/[,٬]/g, ""))?.[0] ?? "NaN");
    check(`today's ${kind} count is above zero`, used > 0, "> 0", meters[i]);
  }
  await goto(demo, "/admin");
  has("the overview shows the ask card in its too_few state", await body(demo), copy("admin.ask.tooFew"));

  // ---- Step 10: the other company has AI off. ----
  step("10. The other company's rep");
  await goto(other, "/app/assistant");
  has("the other company's assistant shows the unavailable line", await body(other), copy("assistant.unavailable.disabled"));
  await goto(other, `/app/close?date=${TODAY}`);
  await other.getByRole("group", { name: copy("close.methodLabel") }).getByRole("button", { name: copy("close.methodPhoto") }).click();
  has("the other company's photo button shows the unavailable line", await body(other), copy("ai.unavailable.company_off"));

  // ---- Maintenance ran after the uploads and questions without trouble. ----
  step("Server log");
  check("no maintenance run failed", !/maintenance failed|sweep failed|maintenance: /i.test(serverLog), "no maintenance error in the server output", serverLog.slice(-400));
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
  check("no request left the local server", leaks.length === 0, "no request to another host", JSON.stringify(leaks));
  console.log(`\nAll ${checks.length} checks passed.`);
} catch (e) {
  console.error(`\n${e.message}`);
  if (leaks.length > 0) console.error(`Requests to other hosts (aborted): ${JSON.stringify(leaks)}`);
  code = 1;
} finally {
  await cleanup();
}
process.exit(code);
