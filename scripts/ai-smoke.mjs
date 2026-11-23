// Opt-in live check of the AI providers: `AI_SMOKE=1 pnpm ai:smoke` (run through tsx so it uses the
// real adapters in src/server/ai). Never part of `pnpm test`, e2e or CI.
//
//  - Refuses to run unless AI_SMOKE=1, and refuses when CI is set.
//  - Keys come from the environment only (GEMINI_API_KEY, GROQ_API_KEY, OPENROUTER_API_KEY) and are
//    never printed. AI_SMOKE_PROXY_AUTH=1 sends a placeholder key for providers without one (the
//    sandbox proxy injects the real credential for connected hosts).
//  - FIRST lists the models each key can use, so the owner can see which ids exist (for example
//    whether `gemini-4-hydrogen` is there), then makes one tiny call per job with a synthetic image
//    and a synthetic tone generated here. No real data, no database, nothing written anywhere.
//  - Prints a pass/fail table with measured latency. Response bodies are never printed.
//  - Model ids come from the same variables as the app (AI_GEMINI_*_MODEL, AI_GROQ_STT_MODEL,
//    AI_OPENROUTER_*_MODEL); set them to try another id without changing code.
import { readAiConfig } from "../src/server/ai/config.ts";
import { geminiProvider } from "../src/server/ai/gemini.ts";
import { openrouterProvider } from "../src/server/ai/openrouter.ts";
import { parseJsonReply } from "../src/server/ai/json.ts";
import { Secret } from "../src/server/ai/secret.ts";

if (process.env.AI_SMOKE !== "1") {
  console.error("ai:smoke makes real, possibly billed, requests. Run it as: AI_SMOKE=1 pnpm ai:smoke");
  process.exit(2);
}
if (process.env.CI) {
  console.error("ai:smoke refuses to run when CI is set.");
  process.exit(2);
}

// Endpoints for the model lists (kept next to the adapters' own constants in gemini.ts / groq.ts /
// openrouter.ts; correct both together).
const LISTS = {
  gemini: { url: "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000", header: "x-goog-api-key", prefix: "" },
  groq: { url: "https://api.groq.com/openai/v1/models", header: "authorization", prefix: "Bearer " },
  openrouter: { url: "https://openrouter.ai/api/v1/models", header: "authorization", prefix: "Bearer " },
};
const PLACEHOLDER = "proxy-placeholder";
const proxyAuth = process.env.AI_SMOKE_PROXY_AUTH === "1";
const config = readAiConfig({ ...process.env, AI_PROVIDER: undefined, AI_DISABLED: undefined });
for (const name of ["gemini", "groq", "openrouter"]) {
  if (config[name].key === null && proxyAuth) config[name].key = new Secret(PLACEHOLDER);
}

const LIMIT_MS = 30_000;
const signal = () => AbortSignal.timeout(LIMIT_MS);
const rows = [];
const say = (s = "") => console.log(s);

const LIST_CAP = 5_000_000;
/** Reads at most `cap` bytes of a body as text; null when longer. */
async function readCapped(res, cap) {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > cap) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}
/** Ids come from the provider: keep printable ASCII only before printing. */
const printable = (s) => String(s).replace(/[^\x20-\x7e]/g, "?").slice(0, 120);

async function listModels(name) {
  const { url, header, prefix } = LISTS[name];
  try {
    const res = await fetch(url, { headers: { [header]: prefix + config[name].key.reveal() }, redirect: "error", signal: signal() });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const text = await readCapped(res, LIST_CAP);
    if (text === null) return { error: "list too large" };
    const json = JSON.parse(text);
    if (json === null || typeof json !== "object") return { error: "unexpected reply" };
    return { json };
  } catch {
    return { error: "request failed" };
  }
}

function modelIds(name, json) {
  if (name === "gemini") {
    return (Array.isArray(json.models) ? json.models : [])
      .filter((m) => (m.supportedGenerationMethods ?? []).includes("generateContent"))
      .map((m) => printable(String(m.name ?? "").replace(/^models\//, "")));
  }
  if (name === "groq") return (Array.isArray(json.data) ? json.data : []).map((m) => printable(m.id));
  // OpenRouter: only the free ones.
  return (Array.isArray(json.data) ? json.data : [])
    .filter((m) => String(m.id).endsWith(":free") || (m.pricing && Number(m.pricing.prompt) === 0 && Number(m.pricing.completion) === 0))
    .map((m) => printable(m.id) + (m.architecture?.input_modalities?.includes("image") ? " [image]" : ""));
}

say("== Models available to each key ==");
for (const name of ["gemini", "groq", "openrouter"]) {
  if (config[name].key === null) {
    say(`${name}: no key (skipped)`);
    continue;
  }
  const r = await listModels(name);
  if (r.error) {
    say(`${name}: could not list models (${r.error})`);
    continue;
  }
  const ids = modelIds(name, r.json);
  say(`${name}: ${ids.length} model(s)${name === "openrouter" ? " (free only)" : ""}`);
  say(ids.sort().map((i) => `  ${i}`).join("\n"));
  if (name === "gemini") {
    const wanted = ["gemini-4-hydrogen", config.gemini.visionModel, config.gemini.chatModel, config.gemini.audioModel];
    for (const w of [...new Set(wanted)]) say(`  -> ${w}: ${ids.includes(w) ? "AVAILABLE" : "NOT in the list"}`);
  }
  if (name === "groq") say(`  -> ${config.groq.sttModel}: ${ids.includes(config.groq.sttModel) ? "AVAILABLE" : "NOT in the list"}`);
}

// ---- synthetic inputs, generated here ----
async function makeJpeg() {
  const { default: sharp } = await import("sharp");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="white"/><text x="2" y="38" font-size="14" font-family="sans-serif" fill="black">CASH 100</text></svg>`;
  return new Uint8Array(await sharp(Buffer.from(svg)).flatten({ background: "#ffffff" }).jpeg({ quality: 85 }).toBuffer());
}
/** One second of a 440 Hz tone: 16 kHz, mono, 16-bit PCM WAV. */
function makeWav() {
  const rate = 16_000;
  const n = rate;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 8000), 44 + i * 2);
  return new Uint8Array(buf);
}

const okReply = (text) => {
  const v = parseJsonReply(text);
  return v !== null && typeof v === "object" && v.ok === true;
};

async function timed(provider, job, model, fn, parsed) {
  const t0 = Date.now();
  last.status = null;
  last.finish = null;
  let outcome = "ok";
  let ok = false;
  let reply = false;
  try {
    const r = await fn();
    ok = true;
    reply = parsed(r.text);
  } catch (e) {
    outcome = typeof e?.code === "string" ? e.code : "error";
  }
  rows.push({ provider, job, model: model ?? "-", outcome, http: last.status === null ? "-" : String(last.status), finish: last.finish ?? "-", latencyMs: Date.now() - t0, parsed: ok ? (reply ? "yes" : "no") : "-", pass: ok && reply });
}

// Records the HTTP status of the last adapter request (and, for Gemini, the finishReason, read
// from a clone with a size cap) so a failure says which kind it was: 400 (request shape), 401/403
// (key), 404 (model id), 429 (limit). No body is printed.
const last = { status: null, finish: null };
const recordingFetch = async (url, init) => {
  last.status = null;
  last.finish = null;
  const res = await fetch(url, init);
  last.status = res.status;
  if (res.ok && String(url).startsWith("https://generativelanguage.googleapis.com/")) {
    try {
      const text = await readCapped(res.clone(), 1_000_000);
      const reason = text === null ? null : JSON.parse(text)?.candidates?.[0]?.finishReason;
      last.finish = typeof reason === "string" ? printable(reason) : null;
    } catch {
      last.finish = null;
    }
  }
  return res;
};

const question = 'Reply with the JSON {"ok":true}';
const jpeg = await makeJpeg();

for (const [name, make] of [
  ["gemini", () => geminiProvider(config.gemini, recordingFetch)],
  ["openrouter", () => openrouterProvider(config.openrouter, recordingFetch)],
]) {
  if (config[name].key === null) continue;
  const p = make();
  if (p.modelFor("vision")) {
    await timed(name, "vision", p.modelFor("vision"), () =>
      p.vision({ image: jpeg, system: "Reply only with JSON.", prompt: 'Reply with the JSON {"ok":true}, and add a "text" field with the text in the image.', maxOutputTokens: 100 }, signal()),
      okReply);
  }
  if (p.modelFor("chat")) {
    await timed(name, "chat", p.modelFor("chat"), () =>
      p.chat({ system: "Reply only with JSON.", messages: [{ role: "user", text: question }], maxOutputTokens: 100 }, signal()),
      okReply);
  }
}

// Speech to text: the adapters only take the recorder's types (webm, mp4, ogg), and this script has
// no encoder for them, so it sends the synthetic WAV tone with the same request shape the adapters
// use (see groq.ts and gemini.ts; correct all together). A pass means the endpoint, auth and model
// work; it does not prove Arabic accuracy.
const wav = makeWav();
if (config.groq.key !== null) {
  const form = new FormData();
  form.set("file", new Blob([wav], { type: "audio/wav" }), "audio.wav");
  form.set("model", config.groq.sttModel);
  form.set("language", "en");
  form.set("response_format", "json");
  form.set("temperature", "0");
  await timed("groq", "stt", config.groq.sttModel, async () => {
    const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST", redirect: "error", signal: signal(), body: form,
      headers: { authorization: `Bearer ${config.groq.key.reveal()}` },
    });
    last.status = res.status;
    if (!res.ok) throw Object.assign(new Error("http"), { code: `http_${res.status}` });
    const j = await res.json();
    if (typeof j?.text !== "string") throw Object.assign(new Error("shape"), { code: "invalid_output" });
    return { text: '{"ok":true}' };
  }, okReply);
}
if (config.gemini.key !== null) {
  const model = config.gemini.audioModel;
  await timed("gemini", "stt", model, async () => {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST", redirect: "error", signal: signal(),
      headers: { "x-goog-api-key": config.gemini.key.reveal(), "content-type": "application/json" },
      body: JSON.stringify({ contents: [{ role: "user", parts: [{ inlineData: { mimeType: "audio/wav", data: Buffer.from(wav).toString("base64") } }, { text: "Transcribe this recording verbatim. Reply with the transcript only." }] }], generationConfig: { temperature: 0, maxOutputTokens: 1024, ...(config.gemini.thinking === "off" ? { thinkingConfig: { thinkingBudget: 0 } } : {}) } }),
    });
    last.status = res.status;
    if (!res.ok) throw Object.assign(new Error("http"), { code: `http_${res.status}` });
    const j = await res.json();
    if (!Array.isArray(j?.candidates)) throw Object.assign(new Error("shape"), { code: "invalid_output" });
    return { text: '{"ok":true}' };
  }, okReply);
}

say();
say("== Results ==");
if (rows.length === 0) say("No provider has a key (set GEMINI_API_KEY, GROQ_API_KEY or OPENROUTER_API_KEY, or AI_SMOKE_PROXY_AUTH=1).");
else {
  const cols = ["provider", "job", "model", "http", "outcome", "finish", "latencyMs", "parsed", "result"];
  const table = rows.map((r) => [r.provider, r.job, r.model, r.http, r.outcome, r.finish, String(r.latencyMs), r.parsed, r.pass ? "PASS" : "FAIL"]);
  const w = cols.map((c, i) => Math.max(c.length, ...table.map((r) => r[i].length)));
  const line = (r) => r.map((c, i) => c.padEnd(w[i])).join("  ");
  say(line(cols));
  for (const r of table) say(line(r));
}
process.exit(rows.some((r) => !r.pass) ? 1 : 0);
