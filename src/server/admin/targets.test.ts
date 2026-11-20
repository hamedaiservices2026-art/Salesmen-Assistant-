import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDatabase } from "drizzle-orm/pg-core";
import { and, eq, sql } from "drizzle-orm";
import { createTestDb } from "@/db/testing";
import { seedDemo, type SeedResult } from "@/db/seed";
import type { Db } from "@/db/client";
import * as s from "@/db/schema";
import type { Ctx } from "@/server/ctx";
import { Forbidden, type Role } from "@/server/auth/roles";
import { getMonthView } from "@/server/repos/month-view";
import { AMOUNT_MAX, applyTargets, getTargetGrid, listTargetChanges } from "./targets";

let db: Db;
let seed: SeedResult;

beforeEach(async () => {
  db = await createTestDb();
  seed = await seedDemo(db);
});

const ctxOf = (userId: string, role: Role, companyId = "demo-co"): Ctx => ({
  db,
  companyId,
  userId,
  role,
  locale: "ar",
  timeZone: "Asia/Riyadh",
});
const admin = () => ctxOf(seed.adminId, "admin");
const ahmed = () => ctxOf("ahmed", "rep");
const NOV = { year: 2026, month: 11 };

async function otherCompany(): Promise<Ctx> {
  // The seed already holds the other company's rep "other-rep", its line "other-line" and a target.
  await db.insert(s.users).values({
    id: "other-admin",
    companyId: "other-co",
    role: "admin",
    name: "Other Admin",
    login: "admin@other.test",
  });
  return ctxOf("other-admin", "admin", "other-co");
}

/** Every target and change row of both companies, so "nothing changed in either company" is one comparison. */
async function snapshot() {
  const targets = (await db.select().from(s.targets)).map((t) => ({ ...t, updatedAt: null, createdAt: null }));
  const changes = await db.select().from(s.targetChanges);
  return {
    targets: targets.sort((a, b) => a.id.localeCompare(b.id)),
    changes: changes.sort((a, b) => a.id.localeCompare(b.id)),
  };
}

const bevOfAhmed = async () => {
  const [row] = await db
    .select()
    .from(s.targets)
    .where(and(eq(s.targets.userId, "ahmed"), eq(s.targets.lineId, "bev"), eq(s.targets.month, 11)));
  return row;
};

const apply = (entries: { userId: string; lineId: string; amount: number | null }[], over = {}) =>
  applyTargets(admin(), { ...NOV, entries, source: "form", ...over });

describe("applyTargets", () => {
  it("sets Ahmed's bev to 3200 and logs one change", async () => {
    const r = await apply([{ userId: "ahmed", lineId: "bev", amount: 3200 }]);
    expect(r).toEqual({ ok: true, changed: 1 });
    expect((await bevOfAhmed())!.amount).toBe(3200);
    const changes = await db.select().from(s.targetChanges);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      companyId: "demo-co",
      userId: "ahmed",
      lineId: "bev",
      year: 2026,
      month: 11,
      oldAmount: 3000,
      newAmount: 3200,
      source: "form",
      changedBy: seed.adminId,
      uploadId: null,
    });
  });

  it("moves Ahmed's expected-by-today figure for bev to 1354", async () => {
    await apply([{ userId: "ahmed", lineId: "bev", amount: 3200 }]);
    const view = await getMonthView(ahmed(), { ...NOV, today: "2026-11-14" });
    expect(view.lines.find((l) => l.lineId === "bev")!.pace.expected).toBe(1354);
  });

  it("changes nothing and logs nothing when the amounts are the same", async () => {
    await apply([{ userId: "ahmed", lineId: "bev", amount: 3200 }]);
    const before = await snapshot();
    expect(await apply([{ userId: "ahmed", lineId: "bev", amount: 3200 }])).toEqual({ ok: true, changed: 0 });
    expect(await snapshot()).toEqual(before);
  });

  it("removes a target with null and logs old to null", async () => {
    await apply([{ userId: "ahmed", lineId: "bev", amount: 3200 }]);
    expect(await apply([{ userId: "ahmed", lineId: "bev", amount: null }])).toEqual({ ok: true, changed: 1 });
    expect(await bevOfAhmed()).toBeUndefined();
    const changes = await db.select().from(s.targetChanges);
    expect(changes.map((c) => [c.oldAmount, c.newAmount]).sort()).toEqual([[3000, 3200], [3200, null]].sort());
  });

  it("removing a target that was never set is no change", async () => {
    await db.delete(s.targets).where(eq(s.targets.userId, "yousef"));
    expect(await apply([{ userId: "yousef", lineId: "bev", amount: null }])).toEqual({ ok: true, changed: 0 });
    expect(await db.select().from(s.targetChanges)).toHaveLength(0);
  });

  it("creates a target that did not exist, logging old null", async () => {
    await db.delete(s.targets).where(eq(s.targets.userId, "yousef"));
    await db.insert(s.uploads).values({ id: "up-1", companyId: "demo-co", kind: "targets", filename: "t.xlsx", uploadedBy: seed.adminId });
    expect(await apply([{ userId: "yousef", lineId: "bev", amount: 900 }], { source: "excel", uploadId: "up-1" })).toEqual({
      ok: true,
      changed: 1,
    });
    const [c] = await db.select().from(s.targetChanges);
    expect(c).toMatchObject({ userId: "yousef", oldAmount: null, newAmount: 900, source: "excel", uploadId: "up-1" });
  });

  it("is all-or-nothing: one bad entry means no write at all", async () => {
    const before = await snapshot();
    const r = await apply([
      { userId: "ahmed", lineId: "bev", amount: 3200 },
      { userId: "khaled", lineId: "bev", amount: -1 },
    ]);
    expect(r).toEqual({ ok: false, errors: { "khaled|bev": "invalid" } });
    expect(await snapshot()).toEqual(before);
  });

  it("rejects negative, fractional and unsafe amounts as invalid", async () => {
    for (const amount of [-1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 2]) {
      expect(await apply([{ userId: "ahmed", lineId: "bev", amount }])).toEqual({ ok: false, errors: { "ahmed|bev": "invalid" } });
    }
  });

  it("rejects a coverage line", async () => {
    await db.insert(s.targetLines).values({
      id: "cov",
      companyId: "demo-co",
      code: "cov",
      nameAr: "تغطية",
      nameEn: "Coverage",
      nameUr: "کوریج",
      unit: "outlets",
      kind: "coverage",
    });
    const before = await snapshot();
    expect(await apply([{ userId: "ahmed", lineId: "cov", amount: 40 }])).toEqual({ ok: false, errors: { "ahmed|cov": "coverage_line" } });
    expect(await snapshot()).toEqual(before);
  });

  it("treats an inactive line, an inactive user and an admin as not_found", async () => {
    await db.update(s.targetLines).set({ active: false }).where(eq(s.targetLines.id, "food"));
    await db.update(s.users).set({ active: false }).where(eq(s.users.id, "omar"));
    const before = await snapshot();
    const r = await apply([
      { userId: "ahmed", lineId: "food", amount: 1 },
      { userId: "omar", lineId: "bev", amount: 1 },
      { userId: seed.adminId, lineId: "bev", amount: 1 },
    ]);
    expect(r).toEqual({
      ok: false,
      errors: { "ahmed|food": "not_found", "omar|bev": "not_found", [`${seed.adminId}|bev`]: "not_found" },
    });
    expect(await snapshot()).toEqual(before);
  });

  it("the last of duplicate entries wins and is logged once", async () => {
    const r = await apply([
      { userId: "ahmed", lineId: "bev", amount: 3100 },
      { userId: "ahmed", lineId: "bev", amount: 3300 },
    ]);
    expect(r).toEqual({ ok: true, changed: 1 });
    expect((await bevOfAhmed())!.amount).toBe(3300);
    const changes = await db.select().from(s.targetChanges);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ oldAmount: 3000, newAmount: 3300 });
  });

  it("refuses an invalid period and non-admin callers", async () => {
    expect(await apply([], { month: 13 })).toEqual({ ok: false, errors: { period: "invalid" } });
    await expect(
      applyTargets(ahmed(), { ...NOV, entries: [], source: "form" }),
    ).rejects.toBeInstanceOf(Forbidden);
    await expect(getTargetGrid(ahmed(), NOV)).rejects.toBeInstanceOf(Forbidden);
    await expect(listTargetChanges(ahmed(), { limit: 5 })).rejects.toBeInstanceOf(Forbidden);
  });

  it("uses the transaction it is given and rolls back with it", async () => {
    await expect(
      db.transaction(async (tx) => {
        const r = await applyTargets(admin(), { ...NOV, entries: [{ userId: "ahmed", lineId: "bev", amount: 3200 }], source: "form" }, tx as unknown as Db);
        expect(r).toEqual({ ok: true, changed: 1 });
        throw new Error("abort");
      }),
    ).rejects.toThrow("abort");
    expect((await bevOfAhmed())!.amount).toBe(3000);
    expect(await db.select().from(s.targetChanges)).toHaveLength(0);
  });
});

describe("applyTargets: zero, cap, transactions, concurrency", () => {
  it("treats 0 as removal and logs new null", async () => {
    expect(await apply([{ userId: "ahmed", lineId: "bev", amount: 0 }])).toEqual({ ok: true, changed: 1 });
    expect(await bevOfAhmed()).toBeUndefined();
    const [c] = await db.select().from(s.targetChanges);
    expect(c).toMatchObject({ oldAmount: 3000, newAmount: null });
    // and 0 where nothing is stored is no change
    expect(await apply([{ userId: "ahmed", lineId: "bev", amount: 0 }])).toEqual({ ok: true, changed: 0 });
  });

  it("caps a value amount at 100,000,000,000 and a case count at 100,000,000 (R26)", async () => {
    expect(await apply([{ userId: "ahmed", lineId: "food", amount: AMOUNT_MAX }])).toEqual({ ok: true, changed: 1 });
    expect(await apply([{ userId: "ahmed", lineId: "food", amount: AMOUNT_MAX + 1 }])).toEqual({
      ok: false,
      errors: { "ahmed|food": "invalid" },
    });
    expect(await apply([{ userId: "ahmed", lineId: "bev", amount: 100_000_000 }])).toEqual({ ok: true, changed: 1 });
    expect(await apply([{ userId: "ahmed", lineId: "bev", amount: 100_000_001 }])).toEqual({
      ok: false,
      errors: { "ahmed|bev": "invalid" },
    });
  });

  it("a bad entry with a passed tx writes and logs nothing and leaves the tx usable", async () => {
    const before = await snapshot();
    await db.transaction(async (tx) => {
      const r = await applyTargets(
        admin(),
        { ...NOV, entries: [{ userId: "ahmed", lineId: "bev", amount: 3200 }, { userId: "khaled", lineId: "bev", amount: -5 }], source: "form" },
        tx as unknown as Db,
      );
      expect(r).toEqual({ ok: false, errors: { "khaled|bev": "invalid" } });
      const r2 = await applyTargets(admin(), { ...NOV, entries: [{ userId: "omar", lineId: "bev", amount: 71 }], source: "form" }, tx as unknown as Db);
      expect(r2).toEqual({ ok: true, changed: 1 });
    });
    const after = await snapshot();
    expect(after.targets.find((x) => x.userId === "ahmed" && x.lineId === "bev")).toEqual(before.targets.find((x) => x.userId === "ahmed" && x.lineId === "bev"));
    expect(after.changes).toHaveLength(1);
  });

  it("two saves creating the same new target at once end with one row and a true old amount in each log row", async () => {
    await db.delete(s.targets).where(and(eq(s.targets.userId, "yousef"), eq(s.targets.lineId, "bev")));
    const [a, b] = await Promise.all([
      apply([{ userId: "yousef", lineId: "bev", amount: 100 }]),
      apply([{ userId: "yousef", lineId: "bev", amount: 200 }]),
    ]);
    expect([a, b]).toEqual([{ ok: true, changed: 1 }, { ok: true, changed: 1 }]);
    const rows = await db.select().from(s.targets).where(and(eq(s.targets.userId, "yousef"), eq(s.targets.lineId, "bev")));
    expect(rows).toHaveLength(1);
    const changes = await db.select().from(s.targetChanges).where(eq(s.targetChanges.userId, "yousef"));
    expect(changes).toHaveLength(2);
    const first = changes.find((c) => c.oldAmount === null)!;
    const second = changes.find((c) => c.oldAmount !== null)!;
    expect(first).toBeDefined();
    expect(second.oldAmount).toBe(first.newAmount);
    expect(rows[0]!.amount).toBe(second.newAmount);
  });

  it("takes the company-month advisory lock before it reads anything (what serializes real Postgres)", async () => {
    const calls: string[] = [];
    const originalExecute = PgDatabase.prototype.execute;
    const execSpy = vi.spyOn(PgDatabase.prototype, "execute").mockImplementation(function (this: PgDatabase<never>, query: Parameters<typeof PgDatabase.prototype.execute>[0]) {
      calls.push(`execute:${JSON.stringify(query)}`);
      return originalExecute.call(this, query);
    });
    const selectProto = Object.getPrototypeOf(db.select().from(s.targets));
    const originalFor = selectProto.for;
    const forSpy = vi.spyOn(selectProto, "for").mockImplementation(function (this: unknown, ...args: unknown[]) {
      calls.push("select-for-update");
      return originalFor.apply(this, args);
    });
    try {
      expect(await apply([{ userId: "ahmed", lineId: "bev", amount: 3200 }])).toEqual({ ok: true, changed: 1 });
    } finally {
      execSpy.mockRestore();
      forSpy.mockRestore();
    }
    expect(calls[0]).toMatch(/pg_advisory_xact_lock/);
    expect(calls[0]).toContain("targets|demo-co|2026|11");
    expect(calls.indexOf("select-for-update")).toBeGreaterThan(0);
  });
});

describe("forged ids from another company", () => {
  it("a user or line of another company is not_found and nothing is written in either company", async () => {
    const other = await otherCompany();
    const before = await snapshot();
    const r = await apply([
      { userId: "other-rep", lineId: "bev", amount: 9 },
      { userId: "ahmed", lineId: "other-line", amount: 9 },
      { userId: "ahmed", lineId: "food", amount: 18_000_001 },
    ]);
    expect(r).toEqual({ ok: false, errors: { "other-rep|bev": "not_found", "ahmed|other-line": "not_found" } });
    expect(await snapshot()).toEqual(before);
    // and in the other direction
    const r2 = await applyTargets(other, {
      ...NOV,
      entries: [
        { userId: "ahmed", lineId: "other-line", amount: 1 },
        { userId: "other-rep", lineId: "bev", amount: 1 },
      ],
      source: "form",
    });
    expect(r2.ok).toBe(false);
    expect(await snapshot()).toEqual(before);
  });

  it("a removal of another company's target does nothing", async () => {
    await otherCompany();
    const before = await snapshot();
    expect(await apply([{ userId: "other-rep", lineId: "other-line", amount: null }])).toEqual({
      ok: false,
      errors: { "other-rep|other-line": "not_found" },
    });
    expect(await snapshot()).toEqual(before);
  });
});

describe("getTargetGrid", () => {
  it("lists active reps and supervisors, active non-coverage lines and their amounts", async () => {
    await db.insert(s.targetLines).values({
      id: "cov",
      companyId: "demo-co",
      code: "cov",
      nameAr: "تغطية",
      nameEn: "Coverage",
      nameUr: "کوریج",
      unit: "outlets",
      kind: "coverage",
    });
    await db.update(s.users).set({ active: false }).where(eq(s.users.id, "omar"));
    const grid = await getTargetGrid(admin(), NOV);
    expect(grid.lines.map((l) => l.lineId)).toEqual(["bev", "food", "coll"]);
    const ids = grid.reps.map((r) => r.id);
    expect(ids).toEqual(expect.arrayContaining(["ahmed", "khaled", "yousef", "sami"]));
    expect(ids).not.toContain("omar");
    expect(ids).not.toContain(seed.adminId);
    expect(grid.amounts["ahmed|bev"]).toBe(3000);
    expect(grid.amounts["ahmed|food"]).toBe(18_000_000);
    expect(grid.amounts["yousef|bev"]).toBe(3000);
  });

  it("does not show the other company's reps or amounts", async () => {
    await otherCompany();
    const grid = await getTargetGrid(admin(), NOV);
    expect(grid.reps.map((r) => r.id)).not.toContain("other-rep");
    expect(Object.keys(grid.amounts).some((k) => k.startsWith("other-rep"))).toBe(false);
  });
});

describe("listTargetChanges", () => {
  it("lists the newest first with names, and only the caller's company", async () => {
    const other = await otherCompany();
    await apply([{ userId: "ahmed", lineId: "bev", amount: 3200 }]);
    await apply([{ userId: "ahmed", lineId: "bev", amount: null }]);
    await applyTargets(other, { ...NOV, entries: [{ userId: "other-rep", lineId: "other-line", amount: 600 }], source: "form" });
    const log = await listTargetChanges(admin(), { limit: 50 });
    expect(log).toHaveLength(2);
    expect(log[0]).toMatchObject({ oldAmount: 3200, newAmount: null, repName: "أحمد", year: 2026, month: 11, source: "form" });
    expect(log[1]).toMatchObject({ oldAmount: 3000, newAmount: 3200 });
    expect(log[0]!.at).toBeInstanceOf(Date);
    expect(log[0]!.byName).toBe((await db.select().from(s.users).where(eq(s.users.id, seed.adminId)))[0]!.name);
    expect(await listTargetChanges(admin(), { limit: 1 })).toHaveLength(1);
  });
});

describe("lock order (A3)", () => {
  it("writes targets in (user, line) order whatever order the entries come in", async () => {
    // Opposite-order deadlocks cannot be provoked deterministically on PGlite (one connection); the
    // property that prevents them is asserted instead: rows are written in sorted order.
    await db.delete(s.targets).where(eq(s.targets.year, 2026));
    const r = await apply([
      { userId: "khaled", lineId: "food", amount: 3 },
      { userId: "ahmed", lineId: "food", amount: 2 },
      { userId: "khaled", lineId: "bev", amount: 4 },
      { userId: "ahmed", lineId: "bev", amount: 1 },
    ]);
    expect(r).toEqual({ ok: true, changed: 4 });
    const rows = (await db.execute(sql`select user_id, line_id from targets order by ctid`)) as unknown as { rows: { user_id: string; line_id: string }[] };
    expect(rows.rows.map((x) => `${x.user_id}|${x.line_id}`)).toEqual([
      "ahmed|bev", "ahmed|food", "khaled|bev", "khaled|food",
    ]);
  });
});
