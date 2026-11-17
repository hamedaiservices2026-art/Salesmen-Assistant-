import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createTestDb } from "@/db/testing";
import { seedDemo, type SeedResult } from "@/db/seed";
import type { Db } from "@/db/client";
import * as s from "@/db/schema";
import type { Ctx } from "@/server/ctx";
import { Forbidden, type Role } from "@/server/auth/roles";
import { getMonthView } from "@/server/repos/month-view";
import { applyTargets, getTargetGrid, listTargetChanges } from "./targets";

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
