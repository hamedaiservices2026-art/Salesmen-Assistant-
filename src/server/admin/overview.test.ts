import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb } from "@/db/testing";
import { seedDemo, type SeedResult } from "@/db/seed";
import type { Db } from "@/db/client";
import * as s from "@/db/schema";
import { Forbidden, type Role } from "@/server/auth/roles";
import type { Ctx } from "@/server/ctx";
import { addCoverageUpdate } from "@/server/repos/coverage";
import { saveClose, type CloseForm } from "@/server/repos/closes";
import { markAllRead } from "@/server/repos/notifications";
import { and, eq } from "drizzle-orm";
import { createIncentive, type IncentiveInput } from "./incentives";
import { getOverview } from "./overview";

const TODAY = "2026-11-14";
const NOV = { year: 2026, month: 11, today: TODAY };

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

const form = (date: string, lines: Record<string, number>): CloseForm => ({
  date,
  lines,
  focus: {},
  cashSales: 0,
  creditSales: 0,
  collections: 0,
  expenses: 0,
  loaded: 0,
  sold: 0,
  returned: 0,
  returns: [],
  note: "",
});

const bonus = (over: Partial<IncentiveInput> = {}): IncentiveInput => ({
  year: 2026,
  month: 11,
  label: { ar: "حافز المشروبات" },
  explanation: { ar: "اوصل لهدف المشروبات" },
  amount: 50000,
  condition: { kind: "line_pct_at_least", lineId: "bev", minPct: 100 },
  startsOn: "2026-11-01",
  endsOn: "2026-11-30",
  expectedVersion: 1,
  ...over,
});

describe("getOverview", () => {
  it("orders the four reps by distance from pace with their statuses and last close", async () => {
    const o = await getOverview(admin(), NOV);
    expect(o.reps.map((r) => r.repId)).toEqual(["yousef", "omar", "ahmed", "khaled"]);
    expect(o.reps.map((r) => r.lines.find((l) => l.lineId === "bev")!.status)).toEqual([
      "behind",
      "behind",
      "slightly_behind",
      "ahead",
    ]);
    expect(o.reps.find((r) => r.repId === "ahmed")).toMatchObject({ supervisorName: "سامي", lastClose: "2026-11-12", closedToday: false });
    expect(o.reps.find((r) => r.repId === "omar")!.supervisorName).toBeNull();
    expect(o.reps.find((r) => r.repId === "yousef")!.lastClose).toBeNull();
    expect(o.counts).toEqual({ total: 26, elapsed: 11, left: 15 });
    expect(o.dayNumber).toBe(12);
    expect(o.onPace).toEqual({ ahead: 1, slightly: 1, behind: 2, total: 4 });
    expect(o.closedToday).toBe(0);
  });

  it("a rep's figures equal his own month view", async () => {
    const o = await getOverview(admin(), NOV);
    const ahmed = o.reps.find((r) => r.repId === "ahmed")!;
    expect(ahmed.lines.find((l) => l.lineId === "bev")).toEqual({
      lineId: "bev",
      target: 3000,
      achieved: 1140,
      expected: 1269,
      pct: 38,
      status: "slightly_behind",
      held: false,
    });
  });

  it("sums the team lines", async () => {
    const o = await getOverview(admin(), NOV);
    const by = (id: string) => o.team.find((t) => t.lineId === id)!;
    expect(by("bev")).toMatchObject({ target: 12000, achieved: 3230, expected: 5077, pct: 26 });
    expect(by("food")).toMatchObject({ target: 72_000_000, achieved: 22_580_000, pct: 31 });
    expect(by("coll")).toMatchObject({ target: 180_000_000, achieved: 51_900_000, pct: 28 });
    expect(o.lines.map((l) => l.lineId)).toEqual(["bev", "food", "coll"]);
  });

  it("counts a close once Ahmed saves today, and moves his last close", async () => {
    await saveClose({ ...ctxOf("ahmed", "rep") }, form(TODAY, { bev: 100 }), { today: TODAY });
    const o = await getOverview(admin(), NOV);
    expect(o.closedToday).toBe(1);
    expect(o.reps.find((r) => r.repId === "ahmed")).toMatchObject({ closedToday: true, lastClose: TODAY });
  });

  it("does not count an upload-created draft close as a close", async () => {
    await db.insert(s.dailyCloses).values({
      id: "draft-yousef",
      companyId: "demo-co",
      userId: "yousef",
      date: TODAY,
      source: "excel",
      status: "draft",
    });
    const o = await getOverview(admin(), NOV);
    expect(o.closedToday).toBe(0);
    expect(o.reps.find((r) => r.repId === "yousef")).toMatchObject({ closedToday: false, lastClose: null });
  });

  it("leaves out inactive reps and supervisors without a target", async () => {
    await db.update(s.users).set({ active: false }).where(eqId("omar"));
    const o = await getOverview(admin(), NOV);
    expect(o.reps.map((r) => r.repId)).toEqual(["yousef", "ahmed", "khaled"]);
    expect(o.onPace.total).toBe(3);
    expect(o.reps.some((r) => r.isSupervisor)).toBe(false);
  });

  it("lists a supervisor who holds a target, tagged, and counts him in the team", async () => {
    await db.insert(s.targets).values({ id: "t-sami-bev", companyId: "demo-co", userId: "sami", year: 2026, month: 11, lineId: "bev", amount: 1000 });
    const o = await getOverview(admin(), NOV);
    expect(o.reps.map((r) => r.repId)).toContain("sami");
    expect(o.reps.find((r) => r.repId === "sami")).toMatchObject({ isSupervisor: true, name: "سامي" });
    expect(o.reps.filter((r) => r.isSupervisor)).toHaveLength(1);
    expect(o.onPace.total).toBe(5);
    expect(o.team.find((t) => t.lineId === "bev")).toMatchObject({ target: 13000, achieved: 3230 });
    // His target in another month does not list him in this one.
    await db.update(s.targets).set({ month: 12 }).where(eq(s.targets.id, "t-sami-bev"));
    expect((await getOverview(admin(), NOV)).reps.map((r) => r.repId)).not.toContain("sami");
  });

  it("never lists another company's supervisor, even with a target", async () => {
    await db.insert(s.users).values({ id: "other-sup", companyId: "other-co", role: "supervisor", name: "Other Sup", login: "sup@other.test" });
    await db.insert(s.targets).values({ id: "t-other-sup", companyId: "other-co", userId: "other-sup", year: 2026, month: 11, lineId: "other-line", amount: 10 });
    expect((await getOverview(admin(), NOV)).reps.map((r) => r.repId)).not.toContain("other-sup");
    await db.insert(s.users).values({ id: "other-admin", companyId: "other-co", role: "admin", name: "Other Admin", login: "admin@other.test" });
    const other = await getOverview(ctxOf("other-admin", "admin", "other-co"), NOV);
    expect(other.reps.map((r) => r.repId).sort()).toEqual(["other-rep", "other-sup"]);
  });

  it("shows coverage as a held figure that never ranks anyone", async () => {
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
    await addCoverageUpdate(ctxOf("khaled", "rep"), { repId: "khaled", lineId: "cov", covered: 40, total: 100, asOf: "2026-11-10" }, { today: TODAY });
    const o = await getOverview(admin(), NOV);
    expect(o.reps.map((r) => r.repId)).toEqual(["yousef", "omar", "ahmed", "khaled"]);
    expect(o.onPace).toEqual({ ahead: 1, slightly: 1, behind: 2, total: 4 });
    expect(o.team.find((t) => t.lineId === "cov")).toMatchObject({ target: 100, achieved: 40, pct: 40, held: true, status: "no_target", expectedPct: null });
    expect(o.reps.find((r) => r.repId === "khaled")!.lines.find((l) => l.lineId === "cov")).toMatchObject({ held: true, status: "no_target" });
  });

  it("lists active incentives with seen and notified, and the rep closest to winning", async () => {
    const r = await createIncentive(admin(), bonus());
    if (!r.ok) throw new Error(JSON.stringify(r));
    await createIncentive(admin(), bonus({ label: { ar: "قديم" }, endsOn: "2026-11-10", expectedVersion: 2 }));
    await markAllRead(ctxOf("ahmed", "rep"));
    const o = await getOverview(admin(), NOV);
    expect(o.incentives).toEqual([
      {
        componentId: r.componentId,
        label: "حافز المشروبات",
        amount: 50000,
        endsOn: "2026-11-30",
        seen: 1,
        notified: 4,
        closest: { name: "خالد", achieved: 1320, needed: 3000, unit: "cases" },
      },
    ]);
  });

  it("reports the last upload", async () => {
    expect((await getOverview(admin(), NOV)).lastUpload).toBeNull();
    await db.insert(s.uploads).values({
      id: "u1",
      companyId: "demo-co",
      kind: "daily",
      filename: "sales_2026-11-13.xlsx",
      rowCount: 412,
      errorCount: 0,
      applied: true,
      errors: [],
      uploadedBy: seed.adminId,
    });
    const o = await getOverview(admin(), NOV);
    expect(o.lastUpload).toMatchObject({ filename: "sales_2026-11-13.xlsx", rows: 412, errorCount: 0, applied: true });
    expect(o.lastUpload!.createdAt).toBeInstanceOf(Date);
  });

  it("shows another company's admin none of these reps", async () => {
    await db.insert(s.users).values({ id: "other-admin", companyId: "other-co", role: "admin", name: "Other Admin", login: "admin@other.test" });
    const o = await getOverview(ctxOf("other-admin", "admin", "other-co"), NOV);
    expect(o.reps.map((r) => r.repId)).toEqual(["other-rep"]);
    expect(o.team.map((t) => t.lineId)).toEqual(["other-line"]);
    expect(o.incentives).toEqual([]);
    expect(o.lastUpload).toBeNull();
  });

  it("refuses every role but admin", async () => {
    for (const [id, role] of [["ahmed", "rep"], ["sami", "supervisor"], ["owner", "owner"]] as const) {
      await expect(getOverview(ctxOf(id, role), NOV)).rejects.toBeInstanceOf(Forbidden);
    }
  });

  it("handles a company with no reps", async () => {
    await db.update(s.users).set({ active: false }).where(eqRole("rep"));
    const o = await getOverview(admin(), NOV);
    expect(o).toMatchObject({ reps: [], onPace: { ahead: 0, slightly: 0, behind: 0, total: 0 }, closedToday: 0 });
  });
});

function eqId(id: string) {
  return eq(s.users.id, id);
}
function eqRole(role: "rep") {
  return and(eq(s.users.role, role), eq(s.users.companyId, "demo-co"));
}
