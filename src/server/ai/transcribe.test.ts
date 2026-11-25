import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "@/db/testing";
import { seedDemo } from "@/db/seed";
import type { Db } from "@/db/client";
import * as s from "@/db/schema";
import { AI_REQUESTED_WITH } from "@/domain/ai/draft";
import { AUDIO_MAX_BYTES } from "@/domain/ai/audio";
import type { Ctx } from "@/server/ctx";
import type { Role } from "@/server/auth/roles";
import { repCtx } from "@/server/admin/rep-ctx";
import { AI_NOTICE_VERSION } from "./availability";
import { readAiConfig } from "./config";
import { fakeProvider } from "./fake";
import { handleTranscribePost, TRANSCRIBE_MAX_BODY } from "./transcribe";
import type { AiProvider, SttRequest } from "./types";

let db: Db;
beforeEach(async () => {
  db = await createTestDb();
  await seedDemo(db);
  await db.update(s.users).set({ aiNoticeVersion: AI_NOTICE_VERSION, aiNoticeAt: new Date() }).where(eq(s.users.id, "ahmed"));
});
afterEach(() => vi.restoreAllMocks());

const ctxOf = (userId: string, role: Role = "rep"): Ctx => ({ db, companyId: "demo-co", userId, role, locale: "ar", timeZone: "Asia/Riyadh" });
const NOW = new Date("2026-11-14T07:00:00Z");
const FAKE = readAiConfig({ AI_PROVIDER: "fake" });
const ascii = (t: string) => new TextEncoder().encode(t);
const WEBM = [0x1a, 0x45, 0xdf, 0xa3];
const webm = (tail = "") => new Uint8Array([...WEBM, ...ascii(tail), ...new Array(200).fill(7)]);
const V1 = "مشروبات مية وعشرين كرتونة، أغذية ٨٢٥٠ ريال، تحصيل عشرين ألف، نقدي خمسة آلاف وخمسمية";
const usage = () => db.select().from(s.aiUsage);

function spied() {
  const base = fakeProvider();
  const stt: SttRequest[] = [];
  const provider: AiProvider = { ...base, async stt(req, signal) { stt.push(req); return base.stt(req, signal); } };
  return { provider, stt };
}

const URL_ = "http://localhost:3000/app/ai/transcribe";
async function post(ctx: Ctx | null, parts: { audio?: Uint8Array | null; type?: string } = {}, headers: Record<string, string> = {}, extra: Record<string, unknown> = {}) {
  const form = new FormData();
  if (parts.audio !== null) form.set("audio", new Blob([(parts.audio ?? webm()) as BlobPart], { type: parts.type ?? "audio/webm" }), "v.webm");
  const encoded = new Response(form);
  const body = new Uint8Array(await encoded.arrayBuffer());
  const req = new Request(URL_, {
    method: "POST",
    body,
    headers: { origin: "http://localhost:3000", host: "localhost:3000", "x-requested-with": AI_REQUESTED_WITH, "content-type": encoded.headers.get("content-type")!, "content-length": String(body.byteLength), ...headers },
  });
  return handleTranscribePost(req, ctx, { now: NOW, config: FAKE, ...extra });
}

describe("POST /app/ai/transcribe (handleTranscribePost)", () => {
  it("returns { transcript }, never cached, and nothing else", async () => {
    const res = await post(ctxOf("ahmed"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ transcript: V1 });
  });

  it("records the usage under the assistant_voice feature, stt kind", async () => {
    await post(ctxOf("ahmed"));
    const rows = await usage();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "stt", feature: "assistant_voice" });
  });

  it("no session → 401; admin or a repCtx → 403; no provider call", async () => {
    const sp = spied();
    expect((await post(null, {}, {}, { providers: [sp.provider] })).status).toBe(401);
    expect((await post(ctxOf("demo-admin", "admin"), {}, {}, { providers: [sp.provider] })).status).toBe(403);
    const tagged = await repCtx(ctxOf("sami", "supervisor"), "ahmed");
    expect((await post(tagged, {}, {}, { providers: [sp.provider] })).status).toBe(403);
    expect(sp.stt).toEqual([]);
    expect(await usage()).toEqual([]);
  });

  it("a supervisor acting as himself is allowed in", async () => {
    await db.update(s.users).set({ aiNoticeVersion: AI_NOTICE_VERSION, aiNoticeAt: new Date() }).where(eq(s.users.id, "sami"));
    expect((await post(ctxOf("sami", "supervisor"))).status).toBe(200);
  });

  it("checks the headers before the body: origin, the ai header, a declared length over the cap", async () => {
    const sp = spied();
    expect((await post(ctxOf("ahmed"), {}, { origin: "https://evil.test" }, { providers: [sp.provider] })).status).toBe(403);
    expect((await post(ctxOf("ahmed"), {}, { "x-requested-with": "photo" }, { providers: [sp.provider] })).status).toBe(403);
    expect((await post(ctxOf("ahmed"), {}, { "content-length": String(TRANSCRIBE_MAX_BODY + 1) }, { providers: [sp.provider] })).status).toBe(413);
    expect((await post(ctxOf("ahmed"), {}, { "content-length": "abc" }, { providers: [sp.provider] })).status).toBe(413);
    expect(sp.stt).toEqual([]);
    expect(await usage()).toEqual([]);
  });

  it("a body longer than the cap is refused whatever Content-Length says", async () => {
    const big = new Uint8Array(TRANSCRIBE_MAX_BODY + 10).fill(0x41);
    big.set(WEBM, 0);
    const res = await post(ctxOf("ahmed"), { audio: big }, { "content-length": "1000" });
    expect(res.status).toBe(413);
    expect(await usage()).toEqual([]);
  });

  it("a recording over 3 000 000 bytes (inside the body cap) → 413 too_large", async () => {
    const big = new Uint8Array(AUDIO_MAX_BYTES + 1);
    big.set(WEBM, 0);
    const res = await post(ctxOf("ahmed"), { audio: big });
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ reason: "too_large" });
  });

  it("html labelled audio/webm → 400 unsupported_type, no provider call", async () => {
    const sp = spied();
    const res = await post(ctxOf("ahmed"), { audio: ascii("<html>x</html>"), type: "audio/webm" }, {}, { providers: [sp.provider] });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ reason: "unsupported_type" });
    expect(sp.stt).toEqual([]);
  });

  it("webm bytes labelled text/html are still read as webm", async () => {
    const sp = spied();
    const res = await post(ctxOf("ahmed"), { type: "text/html" }, {}, { providers: [sp.provider] });
    expect(res.status).toBe(200);
    expect(sp.stt[0]!.mime).toBe("audio/webm");
  });

  it("no audio part or an empty one → 400 no_audio", async () => {
    const a = await post(ctxOf("ahmed"), { audio: null });
    expect(a.status).toBe(400);
    expect(await a.json()).toEqual({ reason: "no_audio" });
    expect((await post(ctxOf("ahmed"), { audio: new Uint8Array() })).status).toBe(400);
  });

  it("an empty transcript → 422 empty; the fake's mumble is still a transcript", async () => {
    const empty = await post(ctxOf("ahmed"), { audio: webm("FAKE:empty\n") });
    expect(empty.status).toBe(422);
    expect(await empty.json()).toEqual({ reason: "empty" });
    const mumble = await post(ctxOf("ahmed"), { audio: webm("FAKE:mumble\n") });
    expect(await mumble.json()).toEqual({ transcript: "يعني النهارده كان يوم كويس" });
  });

  it("maps the AI reasons: notice not accepted 403, company off 403, off 503, no provider 503", async () => {
    await db.update(s.users).set({ aiNoticeVersion: 0 }).where(eq(s.users.id, "ahmed"));
    const a = await post(ctxOf("ahmed"));
    expect(a.status).toBe(403);
    expect(await a.json()).toEqual({ reason: "no_notice" });
    await db.update(s.users).set({ aiNoticeVersion: AI_NOTICE_VERSION }).where(eq(s.users.id, "ahmed"));
    await db.update(s.companies).set({ aiEnabled: false }).where(eq(s.companies.id, "demo-co"));
    expect((await post(ctxOf("ahmed"))).status).toBe(403);
    await db.update(s.companies).set({ aiEnabled: true }).where(eq(s.companies.id, "demo-co"));
    const off = await post(ctxOf("ahmed"), {}, {}, { config: readAiConfig({ AI_DISABLED: "1" }) });
    expect(off.status).toBe(503);
    expect(await off.json()).toEqual({ reason: "disabled" });
  });

  it("a provider that throws is a 502 failed and the reply holds nothing of the error", async () => {
    const boom: AiProvider = { ...fakeProvider(), async stt() { throw new Error("secret-key-123 leaked"); } };
    const res = await post(ctxOf("ahmed"), {}, {}, { providers: [boom] });
    const text = await res.text();
    expect(res.status).toBe(502);
    expect(text).not.toContain("secret-key-123");
  });

  it("an unexpected error is a 500 with a bare reason and is logged by class name only", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const req = new Request(URL_, { method: "POST", body: "x", headers: { origin: "http://localhost:3000", host: "localhost:3000", "x-requested-with": AI_REQUESTED_WITH, "content-length": "1" } });
    const res = await handleTranscribePost(req, { ...ctxOf("ahmed"), get role(): Role { throw new TypeError("secret-key-123"); } } as Ctx, {});
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ reason: "failed" });
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret-key-123");
  });
});
