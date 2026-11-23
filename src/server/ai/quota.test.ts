import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createTestDb } from "@/db/testing";
import { seedDemo } from "@/db/seed";
import type { Db } from "@/db/client";
import * as s from "@/db/schema";
import type { Ctx } from "@/server/ctx";
import { Forbidden, type Role } from "@/server/auth/roles";
import { DEFAULT_LIMITS, USER_DAY, USER_MINUTE, COMPANY_DAY, UPLOADS_USER_DAY } from "./limits";
import { quotaToday, reserve, reserveAi, reserveStatement, sweepCounters } from "./quota";

let db: Db;

beforeEach(async () => {
  db = await createTestDb();
  await seedDemo(db);
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
const NO_GLOBAL_MINUTE = { day: 800, minute: null };
/** 10:00 in Riyadh on 14 Nov 2026 (07:00 UTC). */
const T0 = new Date("2026-11-14T07:00:00Z");
const atMinute = (n: number) => new Date(T0.getTime() + n * 60_000);

async function counter(scope: string, bucket: string, kind: string): Promise<number | null> {
  const [row] = await db
    .select({ count: s.aiCounters.count })
    .from(s.aiCounters)
    .where(and(eq(s.aiCounters.scope, scope), eq(s.aiCounters.bucket, bucket), eq(s.aiCounters.kind, kind)));
  return row?.count ?? null;
}

describe("limits", () => {
  it("has the plan's exact values", () => {
    expect(USER_DAY).toEqual({ vision: 20, stt: 30, chat: 50 });
    expect(USER_MINUTE).toEqual({ vision: 3, stt: 5, chat: 6 });
    expect(COMPANY_DAY).toEqual({ vision: 200, stt: 300, chat: 500 });
    expect(UPLOADS_USER_DAY).toBe(40);
    expect(DEFAULT_LIMITS).toEqual({ userMinute: USER_MINUTE, userDay: USER_DAY, companyDay: COMPANY_DAY });
  });
});

describe("reserve", () => {
  it("lets exactly `limit` of 10 parallel requests through", async () => {
    // The conditional upsert's `WHERE ai_counters.count < limit` is the only guard. Deleting that
    // clause makes this test fail (all 10 pass and the count reads 10): checked once by hand.
    // PGlite runs the 10 statements one after another; the real driver's concurrency rests on
    // Postgres row locking of ON CONFLICT DO UPDATE (see the statement-shape test below).
    const results = await Promise.all(Array.from({ length: 10 }, () => reserve(db, "user:ahmed", "2026-11-14", "chat", 3, "demo-co")));
    expect(results.filter(Boolean)).toHaveLength(3);
    expect(await counter("user:ahmed", "2026-11-14", "chat")).toBe(3);
  });

  it("a limit of 0 (or less) refuses without writing", async () => {
    expect(await reserve(db, "user:ahmed", "2026-11-14", "chat", 0, "demo-co")).toBe(false);
    expect(await reserve(db, "user:ahmed", "2026-11-14", "chat", -1, "demo-co")).toBe(false);
    expect(await counter("user:ahmed", "2026-11-14", "chat")).toBeNull();
  });

  it("is one INSERT … ON CONFLICT DO UPDATE … WHERE count < limit RETURNING statement, with no read first", () => {
    const q = reserveStatement(db, "user:ahmed", "2026-11-14", "chat", 3, "demo-co").toSQL();
    const text = q.sql.toLowerCase();
    expect(text).toMatch(/^insert into "ai_counters" /);
    expect(text).toContain('on conflict ("scope","bucket","kind") do update set');
    expect(text).toMatch(/"count" = "ai_counters"\."count" \+ 1/);
    expect(text).toMatch(/where "ai_counters"\."count" < \$\d+ returning "count"$/);
    expect(text).not.toContain("select");
    expect(text.split(";")).toHaveLength(1);
    expect(q.params).toContain(3);
  });
});

describe("reserveAi", () => {
  it("per-minute limit refuses the 7th chat in one minute, consuming nothing", async () => {
    for (let i = 0; i < 6; i++) expect(await reserveAi(ahmed(), "chat", T0, NO_GLOBAL_MINUTE)).toBe("ok");
    expect(await reserveAi(ahmed(), "chat", T0, NO_GLOBAL_MINUTE)).toBe("rate_limited");
    expect(await counter("user:ahmed", "2026-11-14", "chat")).toBe(6);
    expect(await counter("user:ahmed", "2026-11-14T07:00", "chat")).toBe(6);
    expect(await counter("company:demo-co", "2026-11-14", "chat")).toBe(6);
    expect(await counter("global", "2026-11-14", "chat")).toBe(6);
  });

  it("per-day limit refuses the 51st chat", async () => {
    for (let i = 0; i < 50; i++) {
      expect(await reserveAi(ahmed(), "chat", atMinute(Math.floor(i / 6)), NO_GLOBAL_MINUTE)).toBe("ok");
    }
    expect(await reserveAi(ahmed(), "chat", atMinute(30), NO_GLOBAL_MINUTE)).toBe("user_quota");
    expect(await counter("user:ahmed", "2026-11-14", "chat")).toBe(50);
    expect(await counter("user:ahmed", "2026-11-14T07:30", "chat")).toBeNull();
  });

  it("uses the company's day, not UTC's: 23:30 UTC on the 14th is the 15th in Riyadh", async () => {
    expect(await reserveAi(ahmed(), "chat", new Date("2026-11-14T23:30:00Z"), NO_GLOBAL_MINUTE)).toBe("ok");
    expect(await counter("user:ahmed", "2026-11-15", "chat")).toBe(1);
    expect(await counter("company:demo-co", "2026-11-15", "chat")).toBe(1);
    expect(await counter("global", "2026-11-14", "chat")).toBe(1); // global buckets are UTC days
  });

  it("company day limit (passed by the test, R41): the third rep's first call is refused and his counters stay untouched", async () => {
    const limits = { ...DEFAULT_LIMITS, companyDay: { ...COMPANY_DAY, chat: 2 } };
    expect(await reserveAi(ahmed(), "chat", T0, NO_GLOBAL_MINUTE, limits)).toBe("ok");
    expect(await reserveAi(ctxOf("khaled"), "chat", T0, NO_GLOBAL_MINUTE, limits)).toBe("ok");
    expect(await reserveAi(ctxOf("omar"), "chat", T0, NO_GLOBAL_MINUTE, limits)).toBe("company_quota");
    expect(await counter("user:omar", "2026-11-14", "chat")).toBeNull();
    expect(await counter("user:omar", "2026-11-14T07:00", "chat")).toBeNull();
    expect(await counter("company:demo-co", "2026-11-14", "chat")).toBe(2);
    // Other kinds are counted separately.
    expect(await reserveAi(ctxOf("omar"), "vision", T0, NO_GLOBAL_MINUTE, limits)).toBe("ok");
  });

  it("global day limit: the second call, in another company, is refused", async () => {
    expect(await reserveAi(ahmed(), "chat", T0, { day: 1, minute: null })).toBe("ok");
    expect(await reserveAi(ctxOf("other-rep", "rep", "other-co"), "chat", T0, { day: 1, minute: null })).toBe("global_quota");
    expect(await counter("user:other-rep", "2026-11-14", "chat")).toBeNull();
    expect(await counter("company:other-co", "2026-11-14", "chat")).toBeNull();
  });

  it("global minute limit (R65): the third call in one minute across the deployment is rate_limited", async () => {
    const g = { day: 800, minute: 2 };
    expect(await reserveAi(ahmed(), "chat", T0, g)).toBe("ok");
    expect(await reserveAi(ctxOf("khaled"), "chat", T0, g)).toBe("ok");
    expect(await reserveAi(ctxOf("other-rep", "rep", "other-co"), "chat", T0, g)).toBe("rate_limited");
    expect(await counter("user:other-rep", "2026-11-14", "chat")).toBeNull();
    expect(await counter("global", "2026-11-14T07:00", "chat")).toBe(2);
    expect(await reserveAi(ctxOf("other-rep", "rep", "other-co"), "chat", atMinute(1), g)).toBe("ok");
  });

  it("a zero global day limit refuses everything", async () => {
    expect(await reserveAi(ahmed(), "vision", T0, { day: 0, minute: null })).toBe("global_quota");
    expect(await counter("user:ahmed", "2026-11-14", "vision")).toBeNull();
  });

  it("parallel requests cannot pass the per-minute limit", async () => {
    const results = await Promise.all(Array.from({ length: 12 }, () => reserveAi(ahmed(), "chat", T0, NO_GLOBAL_MINUTE)));
    expect(results.filter((r) => r === "ok")).toHaveLength(6);
    expect(results.filter((r) => r === "rate_limited")).toHaveLength(6);
    expect(await counter("user:ahmed", "2026-11-14", "chat")).toBe(6);
  });

  it("refuses a context made for someone else (repCtx)", async () => {
    await expect(reserveAi({ ...ahmed(), actingFor: "admin" }, "chat", T0, NO_GLOBAL_MINUTE)).rejects.toThrow(Forbidden);
    expect(await counter("user:ahmed", "2026-11-14", "chat")).toBeNull();
  });
});

describe("quotaToday", () => {
  it("reads the caller's and his company's day counters for each kind", async () => {
    await reserveAi(ahmed(), "chat", T0, NO_GLOBAL_MINUTE);
    await reserveAi(ahmed(), "chat", T0, NO_GLOBAL_MINUTE);
    await reserveAi(ctxOf("khaled"), "chat", T0, NO_GLOBAL_MINUTE);
    await reserveAi(ctxOf("khaled"), "vision", T0, NO_GLOBAL_MINUTE);
    await reserveAi(ctxOf("other-rep", "rep", "other-co"), "chat", T0, NO_GLOBAL_MINUTE);
    expect(await quotaToday(ahmed(), T0)).toEqual({
      vision: { user: 0, company: 1 },
      stt: { user: 0, company: 0 },
      chat: { user: 2, company: 3 },
    });
    expect(await quotaToday(ahmed(), new Date("2026-11-15T07:00:00Z"))).toEqual({
      vision: { user: 0, company: 0 },
      stt: { user: 0, company: 0 },
      chat: { user: 0, company: 0 },
    });
  });
});

describe("sweepCounters", () => {
  it("deletes counters not updated for more than 3 days and returns how many", async () => {
    await reserveAi(ahmed(), "chat", T0, NO_GLOBAL_MINUTE); // 4 rows: user minute, user day, company day, global day
    await db.update(s.aiCounters).set({ updatedAt: new Date("2026-11-10T00:00:00Z") }).where(eq(s.aiCounters.scope, "global"));
    expect(await sweepCounters(db, new Date("2026-11-14T00:00:00Z"))).toBe(1);
    expect(await counter("global", "2026-11-14", "chat")).toBeNull();
    expect(await sweepCounters(db, new Date("2026-11-14T00:00:00Z"))).toBe(0);
    const later = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000 + 60_000);
    expect(await sweepCounters(db, later)).toBe(3);
  });
});
