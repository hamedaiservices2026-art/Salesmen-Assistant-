import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createTestDb } from "@/db/testing";
import { seedDemo, type SeedResult } from "@/db/seed";
import type { Db } from "@/db/client";
import * as s from "@/db/schema";
import type { Ctx } from "@/server/ctx";
import { isDailyLine } from "@/domain/lines";
import { getMonthView } from "./month-view";
import { getClose, saveClose, type CloseForm } from "./closes";
import { getCommissionView } from "./commission";
import { getHistoryDays, getHistoryMonths } from "./history";
import { getCompanyPrefs } from "./company";

const TODAY = "2026-11-14";
const NOV = { year: 2026, month: 11, today: TODAY };

let db: Db;
let seed: SeedResult;

beforeEach(async () => {
  db = await createTestDb();
  seed = await seedDemo(db);
});

function ahmed(): Ctx {
  return { db, companyId: seed.companyId, userId: seed.repId, role: "rep", locale: "ar", timeZone: "Asia/Riyadh" };
}

async function otherRep(): Promise<Ctx> {
  const [u] = await db.select().from(s.users).where(eq(s.users.id, seed.otherRepId));
  return { db, companyId: u!.companyId, userId: u!.id, role: "rep", locale: "ar", timeZone: "Asia/Riyadh" };
}

function form(date: string, lines: Record<string, number>, extra: Partial<CloseForm> = {}): CloseForm {
  return {
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
    ...extra,
  };
}

async function bevOf(ctx: Ctx) {
  const view = await getMonthView(ctx, NOV);
  return { view, bev: view.lines.find((l) => l.lineId === "bev")! };
}

describe("getMonthView", () => {
  it("shows Ahmed's three lines in sort order with bev's pace", async () => {
    const view = await getMonthView(ahmed(), NOV);
    expect(view.lines.map((l) => l.lineId)).toEqual(["bev", "food", "coll"]);
    expect(view.counts).toEqual({ total: 26, elapsed: 11, left: 15 });
    const bev = view.lines[0]!;
    expect(bev).toMatchObject({ nameAr: "مشروبات", nameEn: "Beverages", unit: "cases", kind: "sales", target: 3000, achieved: 1140 });
    expect(bev.pace).toEqual({
      expected: 1269,
      gap: 129,
      remaining: 1860,
      requiredDaily: 124,
      status: "slightly_behind",
      pct: 38,
    });
    expect(view.hasClosedToday).toBe(false);
  });

  it("marks every day of the month for bev", async () => {
    const { bev } = await bevOf(ahmed());
    expect(bev.days).toHaveLength(30);
    const expected = Array.from({ length: 30 }, (_, i) => {
      const d = i + 1;
      if ([6, 13, 20, 27].includes(d)) return "off";
      if ([2, 4, 8].includes(d)) return "hit";
      if (d < 14) return "below";
      if (d === 14) return "today";
      return "future";
    });
    expect(bev.days.map((d) => d.mark)).toEqual(expected);
    expect(bev.days[0]).toEqual({ date: "2026-11-01", mark: "below", amount: 96 });
    expect(bev.days[5]!.amount).toBeNull();
    expect(bev.days[13]!.amount).toBeNull();
  });

  it("shows focus items with window-limited achieved and per-day need", async () => {
    const view = await getMonthView(ahmed(), NOV);
    const mango = view.focus.find((f) => f.id === "mango");
    const cola = view.focus.find((f) => f.id === "cola");
    expect(mango).toMatchObject({ name: "عصير مانجو 1 لتر", unit: "cases", target: 200, achieved: 120, perDay: 14 });
    expect(cola).toMatchObject({ target: 400, achieved: 120, perDay: 19 });
  });

  it("returns no lines or amounts of Ahmed to the other company's rep", async () => {
    const view = await getMonthView(await otherRep(), NOV);
    expect(view.lines.map((l) => l.lineId)).toEqual(["other-line"]);
    expect(view.lines[0]!.achieved).toBe(20);
    expect(view.focus).toEqual([]);
    const json = JSON.stringify(view);
    for (const id of ["bev", "food", "coll", "mango", "cola"]) expect(json).not.toContain(`"${id}"`);
  });

  it("shows no_target and no NaN when Ahmed's bev target is deleted", async () => {
    await db.delete(s.targets).where(and(eq(s.targets.userId, "ahmed"), eq(s.targets.lineId, "bev")));
    const view = await getMonthView(ahmed(), NOV);
    const bev = view.lines.find((l) => l.lineId === "bev")!;
    expect(bev.target).toBe(0);
    expect(bev.pace.status).toBe("no_target");
    expect(JSON.stringify(view)).not.toContain("NaN");
    expect(Object.values(bev.pace).some((v) => typeof v === "number" && Number.isNaN(v))).toBe(false);
  });
});

describe("saveClose", () => {
  it("saves today's close and updates the month view", async () => {
    expect(await saveClose(ahmed(), form(TODAY, { bev: 130 }), { today: TODAY })).toEqual({ ok: true });
    const { view, bev } = await bevOf(ahmed());
    expect(bev.achieved).toBe(1270);
    expect(bev.days[13]).toEqual({ date: TODAY, mark: "hit", amount: 130 });
    expect(view.hasClosedToday).toBe(true);
  });

  it("updates, never duplicates, a second submit for the same date", async () => {
    await saveClose(ahmed(), form(TODAY, { bev: 130 }), { today: TODAY });
    expect(await saveClose(ahmed(), form(TODAY, { bev: 100 }), { today: TODAY })).toEqual({ ok: true });
    const rows = await db
      .select()
      .from(s.dailyCloses)
      .where(and(eq(s.dailyCloses.userId, "ahmed"), eq(s.dailyCloses.date, TODAY)));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: "manual", status: "confirmed" });
    const { bev } = await bevOf(ahmed());
    expect(bev.achieved).toBe(1240);
  });

  it("rejects a future date and a Friday", async () => {
    const future = await saveClose(ahmed(), form("2026-11-15", { bev: 10 }), { today: TODAY });
    expect(future).toEqual({ ok: false, errors: { date: "future" } });
    const friday = await saveClose(ahmed(), form("2026-11-13", { bev: 10 }), { today: TODAY });
    expect(friday).toEqual({ ok: false, errors: { date: "not_selling_day" } });
  });

  it("rejects negative numbers and ids outside the caller's lines and focus items", async () => {
    const r = await saveClose(
      ahmed(),
      form(TODAY, { bev: -1, "other-line": 5 }, { focus: { mango: 3, nope: 1 }, cashSales: -5 }),
      { today: TODAY },
    );
    expect(r).toEqual({
      ok: false,
      errors: { "lines.bev": "negative", "lines.other-line": "unknown", "focus.nope": "unknown", cashSales: "negative" },
    });
    expect(await getClose(ahmed(), TODAY)).toBeNull();
  });

  it("treats an inactive own-company line as unknown", async () => {
    await db.update(s.targetLines).set({ active: false }).where(eq(s.targetLines.id, "bev"));
    const r = await saveClose(ahmed(), form(TODAY, { bev: 5 }), { today: TODAY });
    expect(r).toEqual({ ok: false, errors: { "lines.bev": "unknown" } });
  });

  it("treats a focus item that is not assigned to the rep as unknown", async () => {
    await db.delete(s.focusAssignments).where(eq(s.focusAssignments.focusItemId, "mango"));
    const r = await saveClose(ahmed(), form(TODAY, { bev: 5 }, { focus: { mango: 1 } }), { today: TODAY });
    expect(r).toEqual({ ok: false, errors: { "focus.mango": "unknown" } });
  });

  it("rejects an impossible calendar date as invalid", async () => {
    const r = await saveClose(ahmed(), form("2026-02-30", { bev: 5 }), { today: TODAY });
    expect(r).toEqual({ ok: false, errors: { date: "invalid" } });
  });

  it("round-trips a full close through getClose", async () => {
    const full = form(
      TODAY,
      { bev: 130, food: 750_000, coll: 1_700_000 },
      {
        focus: { mango: 15, cola: 12 },
        cashSales: 450_000,
        creditSales: 300_000,
        collections: 1_700_000,
        expenses: 5_000,
        loaded: 140,
        sold: 130,
        returned: 2,
        returns: [{ description: "علب تالفة", quantity: 2, reason: "damaged" }],
        note: "يوم عادي",
      },
    );
    expect(await saveClose(ahmed(), full, { today: TODAY })).toEqual({ ok: true });
    expect(await getClose(ahmed(), TODAY)).toEqual({ ...full, admin: {}, draft: false });
    const view = await getMonthView(ahmed(), NOV);
    expect(view.focus.find((f) => f.id === "mango")!.achieved).toBe(135);
  });
});

describe("saveClose across months and windows", () => {
  const DEC = "2026-12-01";

  it("keeps an earlier month's focus rows when that day is saved again", async () => {
    const first = form("2026-11-12", { bev: 106, food: 790_000 }, { focus: { mango: 15, cola: 12 } });
    expect(await saveClose(ahmed(), first, { today: DEC })).toEqual({ ok: true });
    // The December screen no longer offers the November items, so the post carries none.
    const again = form("2026-11-12", { bev: 107, food: 790_000 }, { focus: {} });
    expect(await saveClose(ahmed(), again, { today: DEC })).toEqual({ ok: true });
    const saved = await getClose(ahmed(), "2026-11-12");
    expect(saved!.lines.bev).toBe(107);
    expect(saved!.focus).toEqual({ mango: 15, cola: 12 });
  });

  it("rejects a focus amount outside the item's window", async () => {
    const afterMango = await saveClose(ahmed(), form("2026-11-21", { bev: 10 }, { focus: { mango: 4, cola: 4 } }), {
      today: DEC,
    });
    expect(afterMango).toEqual({ ok: false, errors: { "focus.mango": "outside_window" } });
    const afterCola = await saveClose(ahmed(), form(DEC, { bev: 10 }, { focus: { cola: 4 } }), { today: DEC });
    expect(afterCola).toEqual({ ok: false, errors: { "focus.cola": "outside_window" } });
  });

  it("keeps a deactivated line's amount when the same day is saved again", async () => {
    await saveClose(ahmed(), form("2026-11-12", { bev: 106, food: 790_000 }), { today: DEC });
    await db.update(s.targetLines).set({ active: false }).where(eq(s.targetLines.id, "bev"));
    expect(await saveClose(ahmed(), form("2026-11-12", { food: 800_000 }), { today: DEC })).toEqual({ ok: true });
    const saved = await getClose(ahmed(), "2026-11-12");
    expect(saved!.lines).toMatchObject({ bev: 106, food: 800_000 });
  });
});

describe("getClose", () => {
  it("returns Ahmed's close to Ahmed only", async () => {
    const mine = await getClose(ahmed(), "2026-11-12");
    expect(mine).toMatchObject({ date: "2026-11-12", lines: { bev: 106, food: 790_000, coll: 1_900_000 } });
    expect(await getClose(await otherRep(), "2026-11-12")).toBeNull();
  });
});

describe("getCommissionView", () => {
  it("evaluates actual, projected and full-target commission with the nearest win", async () => {
    const v = await getCommissionView(ahmed(), NOV);
    expect(v.scheme?.name).toBe("November 2026");
    expect(v.counts).toEqual({ total: 26, elapsed: 11, left: 15 });
    expect(v.input.lines.bev).toEqual({ target: 3000, achieved: 1140 });
    expect(v.input.focus.mango).toEqual({ achieved: 120 });
    expect(v.actual.total).toBe(41400);
    expect(v.projected.total).toBe(347855);
    expect(v.atFullTarget.total).toBe(640000);
    expect(v.nearest).toMatchObject({ componentId: "c_bev", lineId: "bev", gap: 5, gain: 100_000 });
    expect(v.lines.map((l) => l.lineId)).toEqual(["bev", "food", "coll"]);
  });

  it("returns empty evaluations when no scheme is published", async () => {
    const v = await getCommissionView(ahmed(), { year: 2026, month: 12, today: "2026-12-01" });
    expect(v.scheme).toBeNull();
    expect(v.actual).toEqual({ total: 0, results: [] });
    expect(v.projected).toEqual({ total: 0, results: [] });
    expect(v.atFullTarget).toEqual({ total: 0, results: [] });
    expect(v.nearest).toBeNull();
  });
});

describe("history", () => {
  it("lists one month with its commission", async () => {
    const months = await getHistoryMonths(ahmed(), { today: TODAY });
    expect(months).toEqual([
      {
        year: 2026,
        month: 11,
        lines: [
          { lineId: "bev", pct: 38 },
          { lineId: "food", pct: 46 },
          { lineId: "coll", pct: 42 },
        ],
        commission: 41400,
      },
    ]);
  });

  it("lists the month's days newest first with cash to hand over", async () => {
    const days = await getHistoryDays(ahmed(), 2026, 11);
    expect(days).toHaveLength(11);
    expect(days[0]).toEqual({
      date: "2026-11-12",
      lines: { bev: 106, food: 790_000, coll: 1_900_000 },
      admin: {},
      draft: false,
      cashToHandOver: 474_000 + 1_900_000,
    });
    const other = await getHistoryDays(await otherRep(), 2026, 11);
    expect(other.map((d) => d.lines)).toEqual([{ "other-line": 20 }]);
  });
});

describe("nextDayRequired in the month view", () => {
  it("after a close of 130 on 14 Nov: 1730 over the 14 selling days after it", async () => {
    await saveClose(ahmed(), form(TODAY, { bev: 130 }), { today: TODAY });
    const { bev } = await bevOf(ahmed());
    expect(bev.pace.remaining).toBe(1730);
    expect(bev.nextDayRequired).toBe(124);
  });
  it("on a Friday it divides by the selling days after it", async () => {
    const view = await getMonthView(ahmed(), { year: 2026, month: 11, today: "2026-11-13" });
    expect(view.lines.find((l) => l.lineId === "bev")!.nextDayRequired).toBe(124); // 1860 / 15
  });
  it("is null on the last selling day of the month", async () => {
    const view = await getMonthView(ahmed(), { year: 2026, month: 11, today: "2026-11-30" });
    expect(view.lines.find((l) => l.lineId === "bev")!.nextDayRequired).toBeNull();
  });
});

describe("history without a scheme", () => {
  it("reports a null commission when no scheme is published", async () => {
    await db.update(s.schemes).set({ published: false });
    const [m] = await getHistoryMonths(ahmed(), { today: TODAY });
    expect(m!.commission).toBeNull();
  });
});

describe("company preferences on the rep screens", () => {
  it("reads the company's preferences with defaults", async () => {
    expect(await getCompanyPrefs(ahmed())).toEqual({
      currency: "SAR",
      behindPct: 10,
      timeZone: "Asia/Riyadh",
      defaultLocale: "ar",
      weekStartsOn: 0,
    });
  });

  it("uses the company's behind_pct for pace status", async () => {
    expect((await bevOf(ahmed())).bev.pace.status).toBe("slightly_behind");
    await db.update(s.companies).set({ behindPct: 4 }).where(eq(s.companies.id, seed.companyId));
    expect((await bevOf(ahmed())).bev.pace.status).toBe("behind");
  });

  it("keeps coverage lines in the month view (not in the daily set) and refuses a close amount for one", async () => {
    await db.insert(s.targetLines).values({
      id: "cov", companyId: seed.companyId, code: "cov", nameAr: "تغطية", nameEn: "Coverage", nameUr: "کوریج",
      unit: "outlets", kind: "coverage", sort: 4,
    });
    const view = await getMonthView(ahmed(), NOV);
    expect(view.lines.map((l) => l.lineId)).toEqual(["bev", "food", "coll", "cov"]);
    expect(view.lines.filter(isDailyLine).map((l) => l.lineId)).toEqual(["bev", "food", "coll"]);
    const r = await saveClose(ahmed(), form(TODAY, { bev: 5, cov: 5 }), { today: TODAY });
    expect(r).toEqual({ ok: false, errors: { "lines.cov": "unknown" } });
  });
});
