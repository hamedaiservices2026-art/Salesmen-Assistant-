import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb } from "@/db/testing";
import { seedDemo, type SeedResult } from "@/db/seed";
import type { Db } from "@/db/client";
import * as s from "@/db/schema";
import { Forbidden, type Role } from "@/server/auth/roles";
import type { Ctx } from "@/server/ctx";
import { ASK_DAYS, ASK_K, getAskSummary } from "./ask-summary";

const NOW = new Date("2026-11-14T10:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
let db: Db;
let seed: SeedResult;
let n = 0;

beforeEach(async () => {
  db = await createTestDb();
  seed = await seedDemo(db);
  n = 0;
});

const ctxOf = (userId: string, role: Role, companyId = "demo-co"): Ctx => ({ db, companyId, userId, role, locale: "ar", timeZone: "Asia/Riyadh" });
const admin = () => ctxOf(seed.adminId, "admin");

async function ask(userId: string, topic: string | null, over: Partial<typeof s.aiUsage.$inferInsert> = {}, times = 1) {
  for (let i = 0; i < times; i++) {
    await db.insert(s.aiUsage).values({
      id: `u${n++}`,
      companyId: "demo-co",
      userId,
      kind: "chat",
      feature: "assistant",
      outcome: "ok",
      attempts: 1,
      fallback: false,
      latencyMs: 10,
      topic,
      createdAt: new Date(NOW.getTime() - 2 * DAY),
      ...over,
    });
  }
}

async function seedMain() {
  await ask("ahmed", "remaining", {}, 4);
  await ask("khaled", "remaining");
  await ask("omar", "remaining");
  await ask("ahmed", "commission");
  await ask("khaled", "commission");
  for (const u of ["ahmed", "khaled", "omar", "yousef"]) await ask(u, "policy");
}

describe("getAskSummary", () => {
  it("lists a topic only when at least 3 distinct reps asked it, sorted by reps then questions", async () => {
    await seedMain();
    const r = await getAskSummary(admin(), { now: NOW });
    expect(ASK_K).toBe(3);
    expect(ASK_DAYS).toBe(30);
    expect(r).toEqual({
      state: "ok",
      topics: [
        { topic: "policy", reps: 4, questions: 4 },
        { topic: "remaining", reps: 3, questions: 6 },
      ],
    });
  });

  it("ignores other companies, old rows, failed rows, other features, other and forged topics", async () => {
    await seedMain();
    // other-co reps never count
    await ask(seed.otherRepId, "commission", { companyId: "other-co" });
    await ask("ahmed", "commission", { createdAt: new Date(NOW.getTime() - 31 * DAY) });
    await ask("omar", "commission", { outcome: "timeout" });
    await ask("omar", "commission", { outcome: "rejected" });
    await ask("omar", "commission", { feature: "close_photo", kind: "vision" });
    for (const u of ["ahmed", "khaled", "omar"]) {
      await ask(u, "other");
      await ask(u, "x");
      await ask(u, "'; drop table ai_usage;--");
      await ask(u, null);
    }
    const r = await getAskSummary(admin(), { now: NOW });
    if (r.state !== "ok") throw new Error("expected ok");
    expect(r.topics.map((t) => t.topic)).toEqual(["policy", "remaining"]);
  });

  it("counts the explain feature too", async () => {
    for (const u of ["ahmed", "khaled", "omar"]) await ask(u, "incentive", { feature: "explain" });
    const r = await getAskSummary(admin(), { now: NOW });
    expect(r).toEqual({ state: "ok", topics: [{ topic: "incentive", reps: 3, questions: 3 }] });
  });

  it("is too_few with only one rep's rows", async () => {
    await ask("ahmed", "remaining", {}, 9);
    expect(await getAskSummary(admin(), { now: NOW })).toEqual({ state: "too_few" });
  });

  it("lists at most 5 topics", async () => {
    for (const t of ["standing", "remaining", "commission", "incentive", "policy", "focus", "tips"]) {
      for (const u of ["ahmed", "khaled", "omar"]) await ask(u, t);
    }
    const r = await getAskSummary(admin(), { now: NOW });
    if (r.state !== "ok") throw new Error("expected ok");
    expect(r.topics).toHaveLength(5);
  });

  it("returns no user id, name or text anywhere in the result", async () => {
    await seedMain();
    const text = JSON.stringify(await getAskSummary(admin(), { now: NOW }));
    for (const id of [...["ahmed", "khaled", "omar", "yousef"], seed.adminId, "أحمد", "خالد"]) expect(text).not.toContain(id);
    expect(Object.keys(JSON.parse(text).topics[0]).sort()).toEqual(["questions", "reps", "topic"]);
  });

  it("refuses every role but admin", async () => {
    for (const role of ["rep", "supervisor", "owner"] as const) {
      await expect(getAskSummary(ctxOf("ahmed", role), { now: NOW })).rejects.toBeInstanceOf(Forbidden);
    }
  });
});
