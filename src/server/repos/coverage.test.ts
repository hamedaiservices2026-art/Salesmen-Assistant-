import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "@/db/testing";
import { seedDemo, type SeedResult } from "@/db/seed";
import type { Db } from "@/db/client";
import * as s from "@/db/schema";
import { sampleScheme } from "@/domain/commission/sample-fixture";
import { isDailyLine } from "@/domain/lines";
import { Forbidden, type Role } from "@/server/auth/roles";
import type { Ctx } from "@/server/ctx";
import { repCtx } from "@/server/admin/rep-ctx";
import { getCommissionView } from "./commission";
import { saveClose } from "./closes";
import { addCoverageUpdate, latestCoverage, listCoverageReps } from "./coverage";
import { getMonthView } from "./month-view";

const TODAY = "2026-11-14";
const NOV = { year: 2026, month: 11, today: TODAY };

let db: Db;
let seed: SeedResult;

beforeEach(async () => {
  db = await createTestDb();
  seed = await seedDemo(db);
  await db.insert(s.targetLines).values({
    id: "cov",
    companyId: "demo-co",
    code: "cov",
    nameAr: "التغطية",
    nameEn: "Coverage",
    nameUr: "کوریج",
    unit: "outlets",
    kind: "coverage",
    sort: 4,
  });
});

const ctxOf = (userId: string, role: Role, companyId = "demo-co"): Ctx => ({
  db,
  companyId,
  userId,
  role,
  locale: "ar",
  timeZone: "Asia/Riyadh",
});
const ahmed = () => ctxOf("ahmed", "rep");
const khaled = () => ctxOf("khaled", "rep");
const sami = () => ctxOf("sami", "supervisor");
const admin = () => ctxOf(seed.adminId, "admin");
const upd = (repId: string, covered: number, total: number, asOf: string) => ({ repId, lineId: "cov", covered, total, asOf });
const opts = { today: TODAY };
const rows = () => db.select().from(s.coverageUpdates);

describe("addCoverageUpdate", () => {
  it("lets a rep record his own coverage and stores who entered it", async () => {
    expect(await addCoverageUpdate(ahmed(), upd("ahmed", 50, 120, "2026-11-10"), opts)).toEqual({ ok: true });
    expect(await rows()).toMatchObject([
      { companyId: "demo-co", userId: "ahmed", lineId: "cov", covered: 50, total: 120, asOf: "2026-11-10", enteredBy: "ahmed", enteredRole: "rep" },
    ]);
  });

  it("lets his supervisor update it; the latest is the supervisor's, by name", async () => {
    await addCoverageUpdate(ahmed(), upd("ahmed", 50, 120, "2026-11-10"), opts);
    expect(await addCoverageUpdate(sami(), upd("ahmed", 60, 120, "2026-11-12"), opts)).toEqual({ ok: true });
    const latest = (await latestCoverage(ahmed(), 2026, 11)).get("cov");
    expect(latest).toEqual({ lineId: "cov", covered: 60, total: 120, asOf: "2026-11-12", enteredByName: "سامي", enteredRole: "supervisor" });
  });

  it("ranks by as_of before created_at: a later-entered update for an earlier date does not win", async () => {
    await addCoverageUpdate(sami(), upd("ahmed", 60, 120, "2026-11-12"), opts);
    await addCoverageUpdate(ahmed(), upd("ahmed", 55, 120, "2026-11-11"), opts);
    expect((await latestCoverage(ahmed(), 2026, 11)).get("cov")).toMatchObject({ covered: 60, asOf: "2026-11-12" });
  });

  it("breaks a tie on the same date by the later entry", async () => {
    await addCoverageUpdate(ahmed(), upd("ahmed", 50, 120, "2026-11-12"), opts);
    await new Promise((r) => setTimeout(r, 5));
    await addCoverageUpdate(sami(), upd("ahmed", 58, 120, "2026-11-12"), opts);
    expect((await latestCoverage(ahmed(), 2026, 11)).get("cov")).toMatchObject({ covered: 58, enteredByName: "سامي" });
  });

  it("lets an admin update any rep of the company", async () => {
    expect(await addCoverageUpdate(admin(), upd("omar", 30, 100, "2026-11-13"), opts)).toEqual({ ok: true });
    expect((await rows())[0]).toMatchObject({ userId: "omar", enteredBy: seed.adminId, enteredRole: "admin" });
  });

  it("refuses a supervisor for a rep who is not his, nothing written", async () => {
    expect(await addCoverageUpdate(sami(), upd("omar", 30, 100, "2026-11-13"), opts)).toEqual({ ok: false, errors: { repId: "not_found" } });
    expect(await rows()).toEqual([]);
  });

  it("refuses a rep for another rep", async () => {
    expect(await addCoverageUpdate(ahmed(), upd("khaled", 30, 100, "2026-11-13"), opts)).toEqual({ ok: false, errors: { repId: "not_found" } });
    expect(await rows()).toEqual([]);
  });

  it("refuses an admin for a rep of another company, and the other company's admin for ours", async () => {
    expect(await addCoverageUpdate(admin(), upd("other-rep", 3, 10, "2026-11-13"), opts)).toEqual({ ok: false, errors: { repId: "not_found" } });
    await db.insert(s.users).values({ id: "other-admin", companyId: "other-co", role: "admin", name: "O", login: "other-admin@x.test" });
    expect(await addCoverageUpdate(ctxOf("other-admin", "admin", "other-co"), upd("ahmed", 3, 10, "2026-11-13"), opts)).toEqual({
      ok: false,
      errors: { repId: "not_found" },
    });
    expect(await rows()).toEqual([]);
  });

  it("refuses an owner", async () => {
    const owner = ctxOf(seed.ownerId, "owner", "platform");
    expect(await addCoverageUpdate(owner, upd("ahmed", 3, 10, "2026-11-13"), opts)).toEqual({ ok: false, errors: { repId: "not_found" } });
  });

  it("refuses a line that is not an active coverage line of the company", async () => {
    for (const lineId of ["bev", "other-line", "nope"]) {
      expect(await addCoverageUpdate(ahmed(), { ...upd("ahmed", 3, 10, "2026-11-13"), lineId }, opts)).toEqual({
        ok: false,
        errors: { lineId: "not_coverage" },
      });
    }
    await db.update(s.targetLines).set({ active: false }).where(eq(s.targetLines.id, "cov"));
    expect(await addCoverageUpdate(ahmed(), upd("ahmed", 3, 10, "2026-11-13"), opts)).toEqual({ ok: false, errors: { lineId: "not_coverage" } });
    expect(await rows()).toEqual([]);
  });

  it("refuses covered above total, a total below 1, and a future date", async () => {
    expect(await addCoverageUpdate(ahmed(), upd("ahmed", 130, 120, "2026-11-10"), opts)).toEqual({ ok: false, errors: { covered: "covered_above_total" } });
    expect(await addCoverageUpdate(ahmed(), upd("ahmed", 0, 0, "2026-11-10"), opts)).toEqual({ ok: false, errors: { total: "invalid" } });
    expect(await addCoverageUpdate(ahmed(), upd("ahmed", 50, 120, "2026-11-15"), opts)).toEqual({ ok: false, errors: { asOf: "future" } });
    expect(await rows()).toEqual([]);
  });

  it("accepts today and covered equal to total", async () => {
    expect(await addCoverageUpdate(ahmed(), upd("ahmed", 120, 120, TODAY), opts)).toEqual({ ok: true });
  });
});

describe("latestCoverage", () => {
  it("only counts updates whose date is in the month, and only the rep's own", async () => {
    await addCoverageUpdate(ahmed(), upd("ahmed", 50, 120, "2026-10-30"), opts);
    expect((await latestCoverage(ahmed(), 2026, 11)).size).toBe(0);
    expect((await latestCoverage(ahmed(), 2026, 10)).get("cov")).toMatchObject({ covered: 50 });
    await addCoverageUpdate(khaled(), upd("khaled", 90, 100, "2026-11-12"), opts);
    expect((await latestCoverage(ahmed(), 2026, 11)).size).toBe(0);
    expect((await latestCoverage(khaled(), 2026, 11)).get("cov")).toMatchObject({ covered: 90 });
  });

  it("does not read the other company's rows through a forged context", async () => {
    await db.insert(s.coverageUpdates).values({
      id: "x", companyId: "other-co", userId: "ahmed", lineId: "cov", covered: 1, total: 2, asOf: "2026-11-01", enteredBy: "ahmed", enteredRole: "rep",
    });
    expect((await latestCoverage(ahmed(), 2026, 11)).size).toBe(0);
  });
});

describe("coverage in the month view and the commission", () => {
  async function publishCoverageScheme() {
    const components = [
      ...sampleScheme.components,
      { id: "c_cov", type: "tiered" as const, lineId: "cov", label: "التغطية", tiers: [{ minPct: 85, pay: { kind: "fixed" as const, amount: 100_000 } }] },
    ];
    await db.update(s.schemes).set({ components }).where(eq(s.schemes.id, "scheme-2026-11"));
  }
  const payOf = (e: { results: { componentId: string; amount: number }[] }) => e.results.find((r) => r.componentId === "c_cov")?.amount;

  it("shows the coverage line with the latest figures and no calendar days", async () => {
    await addCoverageUpdate(ahmed(), upd("ahmed", 50, 120, "2026-11-10"), opts);
    const view = await getMonthView(ahmed(), NOV);
    expect(view.lines.map((l) => l.lineId)).toEqual(["bev", "food", "coll", "cov"]);
    const cov = view.lines[3]!;
    expect(cov).toMatchObject({ kind: "coverage", unit: "outlets", target: 120, achieved: 50, days: [], nextDayRequired: null });
    expect(cov.coverage).toEqual({ lineId: "cov", covered: 50, total: 120, asOf: "2026-11-10", enteredByName: "أحمد", enteredRole: "rep" });
    expect(cov.pace.pct).toBe(41);
    expect(view.lines[0]!.coverage).toBeNull();
    expect(view.lines.filter(isDailyLine).map((l) => l.lineId)).toEqual(["bev", "food", "coll"]);
  });

  it("has no pace status for a coverage line (R11), with or without an update", async () => {
    expect((await getMonthView(ahmed(), NOV)).lines[3]).toMatchObject({ coverage: null, target: 0, achieved: 0 });
    expect((await getMonthView(ahmed(), NOV)).lines[3]!.pace.status).toBe("no_target");
    await addCoverageUpdate(ahmed(), upd("ahmed", 50, 120, "2026-11-10"), opts);
    expect((await getMonthView(ahmed(), NOV)).lines[3]!.pace.status).toBe("no_target");
  });

  it("pays the tier on the entered count and does not extrapolate it in the projection", async () => {
    await publishCoverageScheme();
    await addCoverageUpdate(ahmed(), upd("ahmed", 102, 120, "2026-11-13"), opts);
    const view = await getCommissionView(ahmed(), NOV);
    expect(view.input.lines.cov).toEqual({ target: 120, achieved: 102, hold: true });
    expect(payOf(view.actual)).toBe(100_000);
    // 11 of 26 days elapsed: a pace projection would give 102 × 26 ÷ 11 = 241 customers; a held count stays 102.
    expect(payOf(view.projected)).toBe(100_000);
    const projectedCov = view.projected.results.find((r) => r.componentId === "c_cov")!;
    expect(projectedCov.detail).toMatchObject({ lineId: "cov", achieved: 102, pct: 85 });
  });

  it("keeps a below-tier count below the tier in the projection (60 of 120 is not 'on pace' to 85%)", async () => {
    await publishCoverageScheme();
    await addCoverageUpdate(ahmed(), upd("ahmed", 60, 120, "2026-11-13"), opts);
    const view = await getCommissionView(ahmed(), NOV);
    expect(payOf(view.actual)).toBe(0);
    expect(payOf(view.projected)).toBe(0);
    expect(view.projected.results.find((r) => r.componentId === "c_cov")!.detail).toMatchObject({ achieved: 60 });
    // the other lines still project at pace
    expect(view.projected.results.find((r) => r.componentId === "c_bev")!.amount).toBeGreaterThan(0);
  });

  it("lists the coverage line for the commission screen but the day close refuses it", async () => {
    const view = await getCommissionView(ahmed(), NOV);
    expect(view.lines.map((l) => l.lineId)).toContain("cov");
    expect(await saveClose(ahmed(), {
      date: TODAY, lines: { cov: 5 }, focus: {}, cashSales: 0, creditSales: 0, collections: 0, expenses: 0, loaded: 0, sold: 0, returned: 0, returns: [], note: "",
    }, opts)).toEqual({ ok: false, errors: { "lines.cov": "unknown" } });
  });
});

describe("listCoverageReps", () => {
  it("lists a supervisor's own active reps with their latest coverage", async () => {
    await addCoverageUpdate(sami(), upd("ahmed", 60, 120, "2026-11-12"), opts);
    const list = await listCoverageReps(sami(), 2026, 11);
    expect(list.map((r) => r.id)).toEqual(["ahmed", "khaled"]);
    expect(list[0]!.coverage.get("cov")).toMatchObject({ covered: 60 });
    expect(list[1]!.coverage.size).toBe(0);
  });

  it("lists every active rep of the company for an admin, never another company's", async () => {
    const list = await listCoverageReps(admin(), 2026, 11);
    expect(list.map((r) => r.id).sort()).toEqual(["ahmed", "khaled", "omar", "yousef"]);
  });

  it("leaves out an inactive rep, and refuses a rep or owner caller", async () => {
    await db.update(s.users).set({ active: false }).where(eq(s.users.id, "khaled"));
    expect((await listCoverageReps(sami(), 2026, 11)).map((r) => r.id)).toEqual(["ahmed"]);
    await expect(listCoverageReps(ahmed(), 2026, 11)).rejects.toBeInstanceOf(Forbidden);
    await expect(listCoverageReps(ctxOf(seed.ownerId, "owner", "platform"), 2026, 11)).rejects.toBeInstanceOf(Forbidden);
  });
});

describe("a context read through repCtx", () => {
  it("lets a supervisor read his rep's coverage figures but not a stranger's", async () => {
    await addCoverageUpdate(ahmed(), upd("ahmed", 50, 120, "2026-11-10"), opts);
    const asRep = await repCtx(sami(), "ahmed");
    expect((await latestCoverage(asRep!, 2026, 11)).get("cov")).toMatchObject({ covered: 50 });
    expect(await repCtx(sami(), "omar")).toBeNull();
  });
});


describe("C1: addCoverageUpdate guards", () => {
  it("refuses a context made by repCtx (it only reads on someone's behalf)", async () => {
    const acting = (await repCtx(sami(), "ahmed"))!;
    await expect(addCoverageUpdate(acting, upd("ahmed", 5, 10, "2026-11-10"), opts)).rejects.toBeInstanceOf(Forbidden);
    expect(await rows()).toEqual([]);
  });

  it("an inactive rep or supervisor is not_found, for the admin and for his supervisor", async () => {
    await db.update(s.users).set({ active: false }).where(eq(s.users.id, "ahmed"));
    expect(await addCoverageUpdate(admin(), upd("ahmed", 5, 10, "2026-11-10"), opts)).toEqual({ ok: false, errors: { repId: "not_found" } });
    expect(await addCoverageUpdate(sami(), upd("ahmed", 5, 10, "2026-11-10"), opts)).toEqual({ ok: false, errors: { repId: "not_found" } });
    await db.update(s.users).set({ active: false }).where(eq(s.users.id, "sami"));
    expect(await addCoverageUpdate(admin(), upd("sami", 5, 10, "2026-11-10"), opts)).toEqual({ ok: false, errors: { repId: "not_found" } });
    expect(await rows()).toEqual([]);
  });
});
