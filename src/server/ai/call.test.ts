import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "@/db/testing";
import { seedDemo } from "@/db/seed";
import type { Db } from "@/db/client";
import * as s from "@/db/schema";
import type { Ctx } from "@/server/ctx";
import { Forbidden, type Role } from "@/server/auth/roles";
import { AI_NOTICE_VERSION, aiAvailability } from "./availability";
import { aiCall } from "./call";
import { readAiConfig } from "./config";
import { fakeProvider } from "./fake";
import { parseJsonReply } from "./json";
import { logUsage, sweepUsage } from "./usage";
import type { AiProvider, ChatRequest } from "./types";

let db: Db;

beforeEach(async () => {
  db = await createTestDb();
  await seedDemo(db);
});
afterEach(() => {
  vi.restoreAllMocks();
});

const ctxOf = (userId: string, role: Role = "rep", companyId = "demo-co"): Ctx => ({
  db,
  companyId,
  userId,
  role,
  locale: "ar",
  timeZone: "Asia/Riyadh",
});
const ahmed = () => ctxOf("ahmed");
const FAKE = readAiConfig({ AI_PROVIDER: "fake" });
const OFF = readAiConfig({ AI_PROVIDER: "fake", AI_DISABLED: "1" });
const T0 = new Date("2026-11-14T07:00:00Z");
const QUESTION = "كام عمولتي لحد النهارده يا ترى؟";
const noSleep = { sleep: async () => {} };

async function acceptNotice(userId = "ahmed") {
  await db.update(s.users).set({ aiNoticeVersion: AI_NOTICE_VERSION, aiNoticeAt: new Date() }).where(eq(s.users.id, userId));
}

/** The fake, with a spy on `chat`. */
function spiedFake(): AiProvider & { chatSpy: ReturnType<typeof vi.fn> } {
  const base = fakeProvider();
  const chatSpy = vi.fn((req: ChatRequest, signal: AbortSignal) => base.chat(req, signal));
  return { ...base, name: base.name, modelFor: base.modelFor, acceptsAudio: base.acceptsAudio, chat: chatSpy, chatSpy };
}

const ask = (text: string) => ({
  kind: "chat" as const,
  feature: "assistant" as const,
  call: (p: AiProvider, signal: AbortSignal) =>
    p.chat({ system: "s", messages: [{ role: "user", text }], maxOutputTokens: 200 }, signal),
  parse: (t: string) => {
    const v = parseJsonReply(t);
    return v !== null && typeof v === "object" ? (v as Record<string, unknown>) : null;
  },
});

async function usageRows() {
  return db.select().from(s.aiUsage).orderBy(s.aiUsage.createdAt);
}
async function dayCount(scope: string, kind = "chat") {
  const rows = await db.select().from(s.aiCounters).where(eq(s.aiCounters.scope, scope));
  return rows.find((r) => r.bucket === "2026-11-14" && r.kind === kind)?.count ?? 0;
}

describe("aiAvailability", () => {
  it("is AI_NOTICE_VERSION 3 (R83: storage wording corrected)", () => {
    expect(AI_NOTICE_VERSION).toBe(3);
  });

  it("a rep of a company with AI off → company_off", async () => {
    await acceptNotice("other-rep");
    expect(await aiAvailability(ctxOf("other-rep", "rep", "other-co"), "chat", FAKE)).toEqual({ ok: false, reason: "company_off" });
  });

  it("Ahmed before accepting the notice → no_notice; after → ok", async () => {
    expect(await aiAvailability(ahmed(), "chat", FAKE)).toEqual({ ok: false, reason: "no_notice" });
    await acceptNotice();
    expect(await aiAvailability(ahmed(), "chat", FAKE)).toEqual({ ok: true });
    expect(await aiAvailability(ctxOf("sami", "supervisor"), "chat", FAKE)).toEqual({ ok: false, reason: "no_notice" });
  });

  it("mode off → disabled, even for a rep who accepted", async () => {
    await acceptNotice();
    expect(await aiAvailability(ahmed(), "vision", OFF)).toEqual({ ok: false, reason: "disabled" });
  });

  it("no provider for the kind → no_provider", async () => {
    await acceptNotice();
    const live = readAiConfig({}); // live mode, no keys: no adapters
    expect(await aiAvailability(ahmed(), "chat", live)).toEqual({ ok: false, reason: "no_provider" });
    expect(await aiAvailability(ahmed(), "chat", FAKE, [])).toEqual({ ok: false, reason: "no_provider" });
  });

  it("a repCtx context or an admin or owner throws Forbidden", async () => {
    await acceptNotice();
    await expect(aiAvailability({ ...ahmed(), actingFor: "admin" }, "chat", FAKE)).rejects.toThrow(Forbidden);
    await expect(aiAvailability(ctxOf("demo-admin", "admin"), "chat", FAKE)).rejects.toThrow(Forbidden);
    await expect(aiAvailability(ctxOf("owner", "owner", "platform"), "chat", FAKE)).rejects.toThrow(Forbidden);
  });

  it("reads the user's notice in his own company only", async () => {
    await acceptNotice();
    // Ahmed's id with another company's context: no such user there.
    await db.update(s.companies).set({ aiEnabled: true }).where(eq(s.companies.id, "other-co"));
    expect(await aiAvailability(ctxOf("ahmed", "rep", "other-co"), "chat", FAKE)).toEqual({ ok: false, reason: "no_notice" });
  });
});

describe("aiCall", () => {
  it("success: one usage row with codes only, and the value", async () => {
    await acceptNotice();
    const r = await aiCall(ahmed(), ask(QUESTION), { now: T0, config: FAKE, deps: noSleep });
    expect(r).toMatchObject({ ok: true, fallback: false });
    if (r.ok) expect(r.value).toEqual({ answer: "", citations: [], answerable: false });
    const rows = await usageRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      companyId: "demo-co",
      userId: "ahmed",
      kind: "chat",
      feature: "assistant",
      provider: "fake",
      model: "fake-1",
      outcome: "ok",
      attempts: 1,
      fallback: false,
      tokensIn: null,
      tokensOut: null,
      topic: null,
    });
    expect(await dayCount("user:ahmed")).toBe(1);
  });

  it("a provider failure → failed, logged as provider_error, and the request still counts", async () => {
    await acceptNotice();
    const r = await aiCall(ahmed(), ask(`${QUESTION} [[fake:fail]]`), { now: T0, config: FAKE, deps: noSleep });
    expect(r).toEqual({ ok: false, reason: "failed" });
    const rows = await usageRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ outcome: "provider_error", provider: "fake", model: null, attempts: 2, fallback: false });
    expect(await dayCount("user:ahmed")).toBe(1);
    expect(await dayCount("company:demo-co")).toBe(1);
    expect(await dayCount("global")).toBe(1);
  });

  it("a reply that does not parse → unreadable, logged as invalid_output", async () => {
    await acceptNotice();
    const r = await aiCall(ahmed(), ask("[[fake:garbage]]"), { now: T0, config: FAKE, deps: noSleep });
    expect(r).toEqual({ ok: false, reason: "unreadable" });
    expect((await usageRows())[0]).toMatchObject({ outcome: "invalid_output", attempts: 1 });
  });

  it("when availability refuses, no counter moves, nothing is logged and the provider is never called", async () => {
    const fake = spiedFake();
    const r = await aiCall(ahmed(), ask(QUESTION), { now: T0, config: FAKE, providers: [fake] });
    expect(r).toEqual({ ok: false, reason: "no_notice" });
    expect(fake.chatSpy).not.toHaveBeenCalled();
    expect(await db.select().from(s.aiCounters)).toEqual([]);
    expect(await usageRows()).toEqual([]);

    await acceptNotice();
    expect(await aiCall(ahmed(), ask(QUESTION), { now: T0, config: OFF, providers: [fake] })).toEqual({ ok: false, reason: "disabled" });
    expect(await aiCall(ahmed(), ask(QUESTION), { now: T0, config: FAKE, providers: [] })).toEqual({ ok: false, reason: "no_provider" });
    expect(fake.chatSpy).not.toHaveBeenCalled();
    expect(await db.select().from(s.aiCounters)).toEqual([]);
  });

  it("a wrong role or a repCtx context reaches no provider", async () => {
    await acceptNotice();
    const fake = spiedFake();
    await expect(aiCall(ctxOf("demo-admin", "admin"), ask(QUESTION), { now: T0, config: FAKE, providers: [fake] })).rejects.toThrow(Forbidden);
    await expect(aiCall({ ...ahmed(), actingFor: "supervisor" }, ask(QUESTION), { now: T0, config: FAKE, providers: [fake] })).rejects.toThrow(Forbidden);
    expect(fake.chatSpy).not.toHaveBeenCalled();
    expect(await db.select().from(s.aiCounters)).toEqual([]);
  });

  it("the company switch stops the call before any counter or provider", async () => {
    await acceptNotice();
    await db.update(s.companies).set({ aiEnabled: false }).where(eq(s.companies.id, "demo-co"));
    const fake = spiedFake();
    expect(await aiCall(ahmed(), ask(QUESTION), { now: T0, config: FAKE, providers: [fake] })).toEqual({ ok: false, reason: "company_off" });
    expect(fake.chatSpy).not.toHaveBeenCalled();
    expect(await db.select().from(s.aiCounters)).toEqual([]);
  });

  it("a quota refusal is logged as rejected with 0 attempts; the provider is not called", async () => {
    await acceptNotice();
    const fake = spiedFake();
    const config = { ...FAKE, globalDay: { ...FAKE.globalDay, chat: 0 } };
    expect(await aiCall(ahmed(), ask(QUESTION), { now: T0, config, providers: [fake] })).toEqual({ ok: false, reason: "quota" });
    expect(fake.chatSpy).not.toHaveBeenCalled();
    const rows = await usageRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ outcome: "rejected", attempts: 0, provider: null, model: null, latencyMs: 0 });
  });

  it("a per-minute refusal → rate_limited, not logged, provider not called", async () => {
    await acceptNotice();
    const fake = spiedFake();
    const config = { ...FAKE, globalMinute: { ...FAKE.globalMinute, chat: 1 } };
    expect((await aiCall(ahmed(), ask(QUESTION), { now: T0, config, providers: [fake] })).ok).toBe(true);
    expect(await aiCall(ahmed(), ask(QUESTION), { now: T0, config, providers: [fake] })).toEqual({ ok: false, reason: "rate_limited" });
    expect(fake.chatSpy).toHaveBeenCalledTimes(1);
    expect(await usageRows()).toHaveLength(1);
  });

  it("passes deadlineAt to the runner (R33): a deadline already gone makes no request and counts", async () => {
    await acceptNotice();
    const fake = spiedFake();
    const r = await aiCall(ahmed(), ask(QUESTION), { now: T0, config: FAKE, providers: [fake], deps: { now: () => 1_000 }, deadlineAt: 999 });
    expect(r).toEqual({ ok: false, reason: "failed" });
    expect(fake.chatSpy).not.toHaveBeenCalled();
    expect((await usageRows())[0]).toMatchObject({ outcome: "timeout", attempts: 0 });
    expect(await dayCount("user:ahmed")).toBe(1);
  });

  it("no usage row holds the question, the reply or a marker", async () => {
    await acceptNotice();
    await aiCall(ahmed(), ask(QUESTION), { now: T0, config: FAKE, deps: noSleep });
    await aiCall(ahmed(), ask(`${QUESTION} [[fake:fail]]`), { now: T0, config: FAKE, deps: noSleep });
    await aiCall(ahmed(), ask(`${QUESTION} [[fake:obey]]`), { now: T0, config: FAKE, deps: noSleep });
    await aiCall(ahmed(), ask(`${QUESTION} [[fake:garbage]]`), { now: T0, config: FAKE, deps: noSleep });
    const rows = await usageRows();
    expect(rows).toHaveLength(4);
    const dump = JSON.stringify(rows);
    expect(dump).not.toContain(QUESTION);
    expect(dump).not.toContain("[[fake");
    expect(dump).not.toContain("9,999");
    expect(dump).not.toContain("عمولت");
  });

  it("keeps a topic only when it is a short code, never free text", async () => {
    await acceptNotice();
    await aiCall(ahmed(), { ...ask(QUESTION), topic: "commission" }, { now: T0, config: FAKE, deps: noSleep });
    await aiCall(ahmed(), { ...ask(QUESTION), topic: QUESTION }, { now: T0, config: FAKE, deps: noSleep });
    expect((await usageRows()).map((r) => r.topic)).toEqual(["commission", null]);
  });
});

describe("logUsage", () => {
  it("swallows a write failure after a detail-free console.error", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const row = {
      kind: "chat" as const,
      feature: "assistant" as const,
      provider: "fake" as const,
      model: "fake-1",
      outcome: "ok" as const,
      attempts: 1,
      fallback: false,
      latencyMs: 5,
      usage: { tokensIn: null, tokensOut: null },
    };
    // A user that does not exist breaks the foreign key.
    await expect(logUsage(ctxOf("nobody-secret-id"), row)).resolves.toBeUndefined();
    expect(err).toHaveBeenCalledTimes(1);
    expect(err.mock.calls[0]).toEqual(["ai usage log failed"]);
    expect(await usageRows()).toEqual([]);
  });

  it("clamps counts it cannot store", async () => {
    await logUsage(ahmed(), {
      kind: "vision",
      feature: "close_photo",
      provider: null,
      model: null,
      outcome: "timeout",
      attempts: 2,
      fallback: false,
      latencyMs: 1e12,
      usage: { tokensIn: -5, tokensOut: 2 ** 40 },
    });
    expect((await usageRows())[0]).toMatchObject({ latencyMs: 2_147_483_647, tokensIn: null, tokensOut: null });
  });
});

describe("sweepUsage", () => {
  it("deletes rows older than 90 days, at most 1000 per call, and returns the number deleted", async () => {
    const old = new Date("2026-08-01T00:00:00Z");
    const recent = new Date("2026-11-01T00:00:00Z");
    const base = { companyId: "demo-co", userId: "ahmed", kind: "chat" as const, feature: "assistant" as const, outcome: "ok" as const, attempts: 1, fallback: false, latencyMs: 1 };
    await db.insert(s.aiUsage).values([
      ...Array.from({ length: 1001 }, (_, i) => ({ ...base, id: `old-${i}`, createdAt: old })),
      { ...base, id: "recent", createdAt: recent },
    ]);
    const now = new Date("2026-11-14T00:00:00Z");
    expect(await sweepUsage(db, now)).toBe(1000);
    expect(await sweepUsage(db, now)).toBe(1);
    expect(await sweepUsage(db, now)).toBe(0);
    expect((await usageRows()).map((r) => r.id)).toEqual(["recent"]);
  });
});

async function setCounter(scope: string, count: number, kind = "chat", bucket = "2026-11-14") {
  await db.insert(s.aiCounters).values({ scope, bucket, kind, companyId: scope === "global" ? null : "demo-co", count });
}

describe("quota refusals are logged at most once per user, kind, day and reason (R67)", () => {
  it("a repeated company_quota refusal writes one row with the deterministic id", async () => {
    await acceptNotice();
    await setCounter("company:demo-co", 500);
    const fake = spiedFake();
    for (let i = 0; i < 4; i++) {
      expect(await aiCall(ahmed(), ask(QUESTION), { now: T0, config: FAKE, providers: [fake] })).toEqual({ ok: false, reason: "quota" });
    }
    const rows = await usageRows();
    expect(rows.map((r) => r.id)).toEqual(["rej:ahmed:chat:2026-11-14:company_quota"]);
    expect(rows[0]).toMatchObject({ outcome: "rejected", attempts: 0 });
    expect(fake.chatSpy).not.toHaveBeenCalled();
  });

  it("a different reason, kind, user or day gets its own row", async () => {
    await acceptNotice();
    await acceptNotice("khaled");
    await setCounter("company:demo-co", 500);
    const config = { ...FAKE, globalDay: { ...FAKE.globalDay, vision: 0 } };
    const fake = spiedFake();
    const visionJob = {
      kind: "vision" as const,
      feature: "close_photo" as const,
      call: (p: AiProvider, signal: AbortSignal) =>
        p.vision({ image: new Uint8Array([1]), system: "s", prompt: "p", maxOutputTokens: 10 }, signal),
      parse: () => ({}),
    };
    await aiCall(ahmed(), ask(QUESTION), { now: T0, config: FAKE, providers: [fake] });
    await aiCall(ahmed(), visionJob, { now: T0, config, providers: [fake] });
    await aiCall(ctxOf("khaled"), ask(QUESTION), { now: T0, config: FAKE, providers: [fake] });
    await setCounter("company:demo-co", 500, "chat", "2026-11-15");
    await aiCall(ahmed(), ask(QUESTION), { now: new Date("2026-11-15T07:00:00Z"), config: FAKE, providers: [fake] });
    const ids = (await usageRows()).map((r) => r.id).sort();
    expect(ids).toContain("rej:ahmed:chat:2026-11-14:company_quota");
    expect(ids).toContain("rej:ahmed:vision:2026-11-14:global_quota");
    expect(ids).toContain("rej:khaled:chat:2026-11-14:company_quota");
    expect(ids).toContain("rej:ahmed:chat:2026-11-15:company_quota");
    expect(ids).toHaveLength(4);
  });

  it("writes no row when the user's day counter is already at its limit", async () => {
    await acceptNotice();
    await setCounter("user:ahmed", 50);
    const fake = spiedFake();
    for (let i = 0; i < 3; i++) {
      expect(await aiCall(ahmed(), ask(QUESTION), { now: T0, config: FAKE, providers: [fake] })).toEqual({ ok: false, reason: "quota" });
    }
    expect(await usageRows()).toEqual([]);
    expect(fake.chatSpy).not.toHaveBeenCalled();
  });
});

describe("a reserved slot always gets a log row (R67)", () => {
  it("when the runner itself throws, the row is provider_error and the caller gets a plain failure", async () => {
    await acceptNotice();
    const hostile = new Proxy({}, { ownKeys: () => { throw new Error("secret-detail-123"); } });
    const r = await aiCall(ahmed(), ask(QUESTION), { now: T0, config: FAKE, providers: [fakeProvider()], deps: hostile as never });
    expect(r).toEqual({ ok: false, reason: "failed" });
    const rows = await usageRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ outcome: "provider_error", attempts: 0, provider: null });
    expect(JSON.stringify(r)).not.toContain("secret-detail");
    expect(await dayCount("user:ahmed")).toBe(1);
  });
});

describe("audioMime reaches the runner (R48)", () => {
  it("an stt job whose only provider refuses the type is refused as no_provider with no request, no row and no counter", async () => {
    await acceptNotice();
    const base = fakeProvider();
    const sttSpy = vi.fn(base.stt);
    const picky: AiProvider = { ...base, acceptsAudio: (m) => m !== "audio/mp4", stt: sttSpy };
    const job = (audioMime?: "audio/mp4" | "audio/webm") => ({
      kind: "stt" as const,
      feature: "close_voice" as const,
      audioMime,
      call: (p: AiProvider, signal: AbortSignal) => p.stt({ audio: new Uint8Array([1]), mime: audioMime ?? "audio/webm", language: "ar" }, signal),
      parse: (t: string) => t || null,
    });
    expect(await aiCall(ahmed(), job("audio/mp4"), { now: T0, config: FAKE, providers: [picky], deps: noSleep })).toEqual({ ok: false, reason: "no_provider" });
    expect(sttSpy).not.toHaveBeenCalled();
    // Refused before the quota: no usage row and no counter (fix round 1).
    expect(await usageRows()).toEqual([]);
    expect(await db.select().from(s.aiCounters)).toEqual([]);
    expect((await aiCall(ahmed(), job("audio/webm"), { now: T0, config: FAKE, providers: [picky], deps: noSleep })).ok).toBe(true);
    expect(sttSpy).toHaveBeenCalledTimes(1);
  });
});
