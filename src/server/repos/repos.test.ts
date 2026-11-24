import { beforeEach, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { createTestDb } from "@/db/testing";
import { seedDemo, type SeedResult } from "@/db/seed";
import type { Db } from "@/db/client";
import * as s from "@/db/schema";
import type { Ctx } from "@/server/ctx";
import { isDailyLine } from "@/domain/lines";
import { getMonthView } from "./month-view";
import { getClose, saveClose, type CloseForm } from "./closes";
import { getCommissionView } from "./commission";
import { getFirstCloseDate, getHistoryDays, getHistoryMonths } from "./history";
import { loadLines } from "./month-data";
import { isOptionalLine, parseCloseForm, zeroEmptiedLines } from "@/app/app/close/parse-form";
import { getCompanyPrefs } from "./company";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, vi } from "vitest";
import { Forbidden } from "@/server/auth/roles";
import { repCtx } from "@/server/admin/rep-ctx";
import { readFile, removeOwnFile, saveUpload } from "@/server/files/files";
import { localStore } from "@/server/files/local-store";
import type { FileStore } from "@/server/files/store";
import { consumeDraftReceipt, createDraftReceipt, sweepDrafts } from "@/server/ai/drafts";

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
    // A saved close's returns always carry their photos (none here; R52).
    expect(await getClose(ahmed(), TODAY)).toEqual({
      ...full,
      returns: full.returns.map((r) => ({ ...r, photos: [] })),
      admin: {},
      draft: false,
    });
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

describe("history after a line is deactivated (R23a)", () => {
  it("a past month still evaluates its published scheme on a line deactivated since", async () => {
    await db.insert(s.schemes).values({
      id: "oct", companyId: seed.companyId, name: "October", year: 2026, month: 10, published: true, version: 1,
      components: [{ id: "t", type: "tiered", label: "x", lineId: "bev", tiers: [{ minPct: 80, pay: { kind: "fixed", amount: 123_000 } }] }],
    });
    await db.insert(s.targets).values({ id: "t-oct", companyId: seed.companyId, userId: "ahmed", lineId: "bev", year: 2026, month: 10, amount: 100 });
    await db.insert(s.dailyCloses).values({ id: "c-oct", companyId: seed.companyId, userId: "ahmed", date: "2026-10-05", status: "confirmed" });
    await db.insert(s.closeLines).values({ id: "cl-oct", companyId: seed.companyId, closeId: "c-oct", lineId: "bev", amount: 90 });
    const octOf = async () => (await getHistoryMonths(ahmed(), { today: TODAY })).find((m) => m.month === 10)!;
    expect((await octOf()).commission).toBe(123_000);
    await db.update(s.targetLines).set({ active: false }).where(eq(s.targetLines.id, "bev"));
    expect((await octOf()).commission).toBe(123_000);
  });
});

describe("amount cap (A4)", () => {
  it("saveClose refuses 1e8 + 1 cases and accepts 1e8 (R26); a value line keeps AMOUNT_MAX", async () => {
    const day = "2026-11-15";
    expect(await saveClose(ahmed(), form(day, { bev: 100_000_001 }), { today: "2026-11-16" })).toEqual({
      ok: false,
      errors: { "lines.bev": "invalid" },
    });
    expect(await saveClose(ahmed(), form(day, { bev: 100_000_000 }), { today: "2026-11-16" })).toEqual({ ok: true });
    expect(await saveClose(ahmed(), form(day, { food: 100_000_000_001 }), { today: "2026-11-16" })).toEqual({
      ok: false,
      errors: { "lines.food": "invalid" },
    });
    expect(await saveClose(ahmed(), form(day, { food: 100_000_000_000 }), { today: "2026-11-16" })).toEqual({ ok: true });
  });
});

describe("lock order (A3)", () => {
  it("saveClose writes close_lines in line id order whatever order the form lists them in", async () => {
    // Deadlocks between two transactions cannot be provoked deterministically on PGlite (one connection),
    // so this asserts the property that prevents them: the physical insert order is the sorted id order.
    const day = "2026-11-15";
    expect(await saveClose(ahmed(), form(day, { food: 5, coll: 7, bev: 9 }), { today: "2026-11-16" })).toEqual({ ok: true });
    const [close] = await db.select().from(s.dailyCloses).where(and(eq(s.dailyCloses.userId, "ahmed"), eq(s.dailyCloses.date, day)));
    const rows = (await db.execute(sql`select line_id from close_lines where close_id = ${close!.id} order by ctid`)) as unknown as { rows: { line_id: string }[] };
    expect(rows.rows.map((r) => r.line_id)).toEqual(["bev", "coll", "food"]);
  });
});

describe("history never lists a later month (A8)", () => {
  it("a December target does not show in November's history", async () => {
    await db.insert(s.targets).values({ id: "t-dec", companyId: seed.companyId, userId: "ahmed", lineId: "bev", year: 2026, month: 12, amount: 100 });
    const months = await getHistoryMonths(ahmed(), { today: TODAY });
    expect(months.map((m) => m.month)).toEqual([11]);
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
        tooLarge: false,
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

describe("getFirstCloseDate", () => {
  it("is the earliest confirmed close of the rep", async () => {
    expect(await getFirstCloseDate(ahmed())).toBe("2026-11-01");
  });
  it("is null for a rep with no closes and ignores an upload draft", async () => {
    const [u] = await db.select().from(s.users).where(eq(s.users.id, "yousef"));
    const ctx: Ctx = { ...ahmed(), userId: u!.id };
    expect(await getFirstCloseDate(ctx)).toBeNull();
    await db.insert(s.dailyCloses).values({
      id: "draft-1",
      companyId: seed.companyId,
      userId: "yousef",
      date: "2026-11-02",
      source: "excel",
      status: "draft",
    });
    expect(await getFirstCloseDate(ctx)).toBeNull();
  });
  it("is company and user scoped", async () => {
    await db.insert(s.dailyCloses).values({
      id: "old-1",
      companyId: seed.companyId,
      userId: "khaled",
      date: "2026-09-02",
      source: "manual",
      status: "confirmed",
    });
    expect(await getFirstCloseDate(ahmed())).toBe("2026-11-01");
    const other = await otherRep();
    const [row] = await db.select().from(s.dailyCloses).where(eq(s.dailyCloses.userId, other.userId)).orderBy(s.dailyCloses.date);
    expect(await getFirstCloseDate(other)).toBe(row?.date ?? null);
  });
});

describe("line createdOn and earlier-month closes", () => {
  it("createdOn is the creation date in the company time zone", async () => {
    await db
      .update(s.targetLines)
      .set({ createdAt: new Date("2026-11-12T21:30:00Z") }) // 00:30 on 13 Nov in Riyadh
      .where(eq(s.targetLines.id, "coll"));
    const lines = await loadLines(ahmed());
    expect(lines.find((l) => l.lineId === "coll")!.createdOn).toBe("2026-11-13");
    expect(lines.find((l) => l.lineId === "bev")!.createdOn < "2026-11-01").toBe(true);
  });

  it("saves a close for an earlier-month Thursday", async () => {
    expect(await saveClose(ahmed(), form("2026-10-29", { bev: 40 }), { today: TODAY })).toEqual({ ok: true });
    expect((await getClose(ahmed(), "2026-10-29"))!.lines).toEqual({ bev: 40 });
  });

  it("a line created 13 Nov is optional on 12 Nov, required on 13 Nov, and 12 Nov re-saves without it", async () => {
    await db
      .update(s.targetLines)
      .set({ createdAt: new Date("2026-11-12T21:30:00Z") }) // 13 Nov in Riyadh
      .where(eq(s.targetLines.id, "coll"));
    const lines = (await loadLines(ahmed())).filter(isDailyLine);
    const inputs = (date: string) =>
      lines.map((l) => ({ lineId: l.lineId, unit: l.unit, kind: l.kind, optional: isOptionalLine(l.createdOn, date) }));
    expect(inputs("2026-11-12").find((l) => l.lineId === "coll")!.optional).toBe(true);
    expect(inputs("2026-11-12").find((l) => l.lineId === "bev")!.optional).toBe(false);
    expect(inputs("2026-11-13").find((l) => l.lineId === "coll")!.optional).toBe(false);

    const data = new FormData();
    data.set("date", "2026-11-12");
    data.set("cashSales", "100");
    data.set("line.bev", "106");
    data.set("line.food", "7900");
    data.set("line.coll", "");
    const parsed = parseCloseForm(data, inputs("2026-11-12"), []);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(await saveClose(ahmed(), parsed.form, { today: TODAY })).toEqual({ ok: true });
    expect((await getClose(ahmed(), "2026-11-12"))!.lines).toMatchObject({ bev: 106, food: 790000 });

    data.set("date", "2026-11-13");
    expect(parseCloseForm(data, inputs("2026-11-13"), [])).toEqual({ ok: false, errors: { "line.coll": "required" } });
  });

  it("emptying an optional rep line that has a stored value replaces it with 0 and collections follow", async () => {
    await db
      .update(s.targetLines)
      .set({ createdAt: new Date("2026-11-12T21:30:00Z") })
      .where(eq(s.targetLines.id, "coll"));
    const saved = await getClose(ahmed(), "2026-11-12");
    expect(saved!.lines["coll"]).toBeGreaterThan(0);
    const inputs = (await loadLines(ahmed()))
      .filter(isDailyLine)
      .map((l) => ({ lineId: l.lineId, unit: l.unit, kind: l.kind, optional: isOptionalLine(l.createdOn, "2026-11-12") }));
    const data = new FormData();
    data.set("date", "2026-11-12");
    data.set("cashSales", "100");
    data.set("line.bev", "106");
    data.set("line.food", "7900");
    data.set("line.coll", "");
    const parsed = parseCloseForm(data, inputs, []);
    if (!parsed.ok) throw new Error("parse");
    const form = zeroEmptiedLines(parsed.form, inputs.filter((l) => l.optional).map((l) => l.lineId), saved);
    expect(await saveClose(ahmed(), form, { today: TODAY })).toEqual({ ok: true });
    const after = await getClose(ahmed(), "2026-11-12");
    expect(after!.lines["coll"]).toBe(0);
    expect(after!.collections).toBe(0);
  });
});

describe("returns with photos (Task 8)", () => {
  let root: string;
  let store: FileStore;
  let jpeg: Uint8Array;
  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "close-photos-"));
    store = localStore(root);
    jpeg ??= new Uint8Array(await sharp({ create: { width: 64, height: 48, channels: 3, background: { r: 99, g: 99, b: 99 } } }).jpeg().toBuffer());
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const ctxOf = (userId: string, role: "rep" | "supervisor" = "rep"): Ctx => ({ ...ahmed(), userId, role });
  async function photo(ctx: Ctx = ahmed(), kind: "return" | "report" = "return", date = TODAY): Promise<string> {
    const r = await saveUpload(ctx, { kind, date, bytes: jpeg }, { store, today: TODAY });
    if (!r.ok) throw new Error(r.error);
    return r.id;
  }
  const withReturn = (photos: string[], date = TODAY) =>
    form(date, { bev: 120, food: 800_000, coll: 2_000_000 }, { cashSales: 100_000, returns: [{ description: "كولا", quantity: 3, reason: "expired", photos }] });
  const fileRow = async (id: string) => (await db.select().from(s.files).where(eq(s.files.id, id)))[0]!;

  it("attaches the photos to the return, lists them back, and re-saving with fewer soft-deletes the rest", async () => {
    const a = await photo();
    const b = await photo();
    expect(await saveClose(ahmed(), withReturn([a, b]), { today: TODAY })).toEqual({ ok: true });
    const saved = await getClose(ahmed(), TODAY);
    expect(saved!.returns).toEqual([{ description: "كولا", quantity: 3, reason: "expired", photos: [a, b] }]);
    const [closeRow] = await db.select().from(s.dailyCloses).where(and(eq(s.dailyCloses.userId, "ahmed"), eq(s.dailyCloses.date, TODAY)));
    for (const id of [a, b]) {
      expect(await fileRow(id)).toMatchObject({ closeId: closeRow!.id, returnPos: 0, deletedAt: null });
      expect((await fileRow(id)).attachedAt).not.toBeNull();
    }

    expect(await saveClose(ahmed(), withReturn([a]), { today: TODAY })).toEqual({ ok: true });
    expect((await fileRow(b)).deletedAt).not.toBeNull();
    expect(await readFile(ahmed(), b, { store })).toBeNull();
    expect((await getClose(ahmed(), TODAY))!.returns[0]!.photos).toEqual([a]);
  });

  it("removing an attached photo waits for the next save; the save without it soft-deletes it (R71)", async () => {
    const a = await photo();
    const b = await photo();
    await saveClose(ahmed(), withReturn([a, b]), { today: TODAY });
    expect(await removeOwnFile(ahmed(), b)).toEqual({ ok: true });
    expect((await getClose(ahmed(), TODAY))!.returns[0]!.photos).toEqual([a, b]);
    await saveClose(ahmed(), withReturn([a]), { today: TODAY });
    expect((await fileRow(b)).deletedAt).not.toBeNull();
    expect((await getClose(ahmed(), TODAY))!.returns[0]!.photos).toEqual([a]);
  });

  it("a removed return row takes its photos with it; moving a photo to another row keeps it", async () => {
    const a = await photo();
    const b = await photo();
    const two = form(TODAY, { bev: 120, food: 800_000, coll: 2_000_000 }, {
      cashSales: 100_000,
      returns: [
        { description: "كولا", quantity: 3, reason: "expired", photos: [a] },
        { description: "عصير", quantity: 1, reason: "damaged", photos: [b] },
      ],
    });
    expect(await saveClose(ahmed(), two, { today: TODAY })).toEqual({ ok: true });
    expect((await fileRow(b)).returnPos).toBe(1);
    const one = form(TODAY, { bev: 120, food: 800_000, coll: 2_000_000 }, {
      cashSales: 100_000,
      returns: [{ description: "عصير", quantity: 1, reason: "damaged", photos: [b] }],
    });
    expect(await saveClose(ahmed(), one, { today: TODAY })).toEqual({ ok: true });
    expect((await fileRow(a)).deletedAt).not.toBeNull();
    expect(await fileRow(b)).toMatchObject({ returnPos: 0, deletedAt: null });
    expect((await getClose(ahmed(), TODAY))!.returns).toEqual([{ description: "عصير", quantity: 1, reason: "damaged", photos: [b] }]);
  });

  it("another rep's photo, a report photo and a photo on another close are unknown, and nothing is written", async () => {
    const khaleds = await photo(ctxOf("khaled"));
    const report = await photo(ahmed(), "report");
    const onTwelfth = await photo(ahmed(), "return", "2026-11-12");
    expect(await saveClose(ahmed(), withReturn([onTwelfth], "2026-11-12"), { today: TODAY })).toEqual({ ok: true });
    for (const id of [khaleds, report, "f".repeat(32)]) {
      expect(await saveClose(ahmed(), withReturn([id]), { today: TODAY })).toEqual({ ok: false, errors: { "returns.0.photos": "unknown" } });
    }
    // His own photo on another close is also named on its own, so the screen can mark it.
    expect(await saveClose(ahmed(), withReturn([onTwelfth]), { today: TODAY })).toEqual({
      ok: false,
      errors: { "returns.0.photos": "unknown", [`photo.${onTwelfth}`]: "unknown" },
    });
    expect(await getClose(ahmed(), TODAY)).toBeNull();
    expect((await fileRow(khaleds)).closeId).toBeNull();
    expect((await fileRow(report)).closeId).toBeNull();
  });

  it("his own photo removed before the save is expired, named per photo, and nothing is written (R70)", async () => {
    const a = await photo();
    const gone = await photo();
    await removeOwnFile(ahmed(), gone);
    expect(await saveClose(ahmed(), withReturn([a, gone]), { today: TODAY })).toEqual({
      ok: false,
      errors: { "returns.0.photos": "expired", [`photo.${gone}`]: "expired" },
    });
    expect(await getClose(ahmed(), TODAY)).toBeNull();
    expect((await fileRow(a)).closeId).toBeNull();
  });

  it("at most 3 photos per return and 12 per close; an id twice is unknown", async () => {
    const ids = Array.from({ length: 15 }, (_, i) => i.toString(16).padStart(32, "a"));
    expect(await saveClose(ahmed(), withReturn(ids.slice(0, 4)), { today: TODAY })).toEqual({
      ok: false,
      errors: { "returns.0.photos": "too_many" },
    });
    const five = form(TODAY, { bev: 1, food: 1, coll: 1 }, {
      returns: [0, 1, 2, 3, 4].map((r) => ({ description: `r${r}`, quantity: 1, reason: "other" as const, photos: ids.slice(r * 3, r * 3 + 3) })),
    });
    expect(await saveClose(ahmed(), five, { today: TODAY })).toEqual({ ok: false, errors: { "returns.4.photos": "too_many" } });
    const a = await photo();
    const twice = form(TODAY, { bev: 1, food: 1, coll: 1 }, {
      returns: [
        { description: "x", quantity: 1, reason: "other", photos: [a] },
        { description: "y", quantity: 1, reason: "other", photos: [a] },
      ],
    });
    expect(await saveClose(ahmed(), twice, { today: TODAY })).toEqual({ ok: false, errors: { "returns.1.photos": "unknown" } });
  });

  it("a malformed id is unknown without a lookup", async () => {
    expect(await saveClose(ahmed(), withReturn(["../../x"]), { today: TODAY })).toEqual({ ok: false, errors: { "returns.0.photos": "unknown" } });
  });

  it("saving through a repCtx context still throws Forbidden", async () => {
    const a = await photo();
    const acting = await repCtx({ ...ahmed(), userId: seed.supervisorId, role: "supervisor" }, "ahmed");
    await expect(saveClose(acting!, withReturn([a]), { today: TODAY })).rejects.toThrow(Forbidden);
  });

  it("history lists a day's return photos, not the removed ones", async () => {
    const a = await photo();
    const b = await photo();
    await saveClose(ahmed(), withReturn([a, b]), { today: TODAY });
    let day = (await getHistoryDays(ahmed(), 2026, 11)).find((d) => d.date === TODAY)!;
    expect(day.returnPhotos).toEqual([{ description: "كولا", photos: [a, b] }]);
    // Soft-deleted (as a later save or the sweep does): no longer listed.
    await db.update(s.files).set({ deletedAt: new Date() }).where(eq(s.files.id, b));
    day = (await getHistoryDays(ahmed(), 2026, 11)).find((d) => d.date === TODAY)!;
    expect(day.returnPhotos).toEqual([{ description: "كولا", photos: [a] }]);
    // Days without photos carry no photo field at all.
    expect((await getHistoryDays(ahmed(), 2026, 11)).find((d) => d.date === "2026-11-12")!.returnPhotos).toBeUndefined();
  });
});

describe("saveClose with a draft receipt (Task 11)", () => {
  const NOW_14 = new Date("2026-11-14T07:00:00Z");
  const full = (date = TODAY) => form(date, { bev: 118, food: 790_000, coll: 1_950_000 }, { cashSales: 1_480_000, collections: 1_950_000 });
  const receipt = async (id: string) => (await db.select().from(s.aiDrafts).where(eq(s.aiDrafts.id, id)))[0]!;
  const sourceOn = async (date: string, userId = "ahmed") =>
    (await db.select().from(s.dailyCloses).where(and(eq(s.dailyCloses.userId, userId), eq(s.dailyCloses.date, date))))[0]?.source;
  const khaled = (): Ctx => ({ ...ahmed(), userId: "khaled" });

  it("a voice receipt stamps the close voice and is used once", async () => {
    const id = await createDraftReceipt(ahmed(), { date: TODAY, source: "voice", fileId: null }, NOW_14);
    expect(await saveClose(ahmed(), full(), { today: TODAY, now: NOW_14, draftId: id })).toEqual({ ok: true });
    expect(await sourceOn(TODAY)).toBe("voice");
    expect((await receipt(id)).usedAt).not.toBeNull();
  });

  it("khaled saving with Ahmed's draftId → manual, Ahmed's receipt still unused (Review Focus 1)", async () => {
    const id = await createDraftReceipt(ahmed(), { date: TODAY, source: "voice", fileId: null }, NOW_14);
    expect(await saveClose(khaled(), full(), { today: TODAY, now: NOW_14, draftId: id })).toEqual({ ok: true });
    expect(await sourceOn(TODAY, "khaled")).toBe("manual");
    expect((await receipt(id)).usedAt).toBeNull();
  });

  it("a receipt of another company's rep is never consumed", async () => {
    const id = await createDraftReceipt(ahmed(), { date: TODAY, source: "voice", fileId: null }, NOW_14);
    const other = await otherRep();
    const otherLines = Object.fromEntries((await loadLines(other)).filter(isDailyLine).map((l) => [l.lineId, 1]));
    expect(await saveClose(other, form(TODAY, otherLines), { today: TODAY, now: NOW_14, draftId: id })).toEqual({ ok: true });
    expect((await receipt(id)).usedAt).toBeNull();
  });

  it("a receipt for 12 Nov used on 14 Nov → manual; it stays usable for 12 Nov", async () => {
    const id = await createDraftReceipt(ahmed(), { date: "2026-11-12", source: "voice", fileId: null }, NOW_14);
    expect(await saveClose(ahmed(), full(), { today: TODAY, now: NOW_14, draftId: id })).toEqual({ ok: true });
    expect(await sourceOn(TODAY)).toBe("manual");
    expect((await receipt(id)).usedAt).toBeNull();
    expect(await saveClose(ahmed(), full("2026-11-12"), { today: TODAY, now: NOW_14, draftId: id })).toEqual({ ok: true });
    expect(await sourceOn("2026-11-12")).toBe("voice");
  });

  it("a receipt 25 hours old → manual", async () => {
    const id = await createDraftReceipt(ahmed(), { date: TODAY, source: "voice", fileId: null }, new Date(NOW_14.getTime() - 25 * 3_600_000));
    expect(await saveClose(ahmed(), full(), { today: TODAY, now: NOW_14, draftId: id })).toEqual({ ok: true });
    expect(await sourceOn(TODAY)).toBe("manual");
    expect((await receipt(id)).usedAt).toBeNull();
  });

  it("an unknown or malformed draftId → manual", async () => {
    expect(await saveClose(ahmed(), full(), { today: TODAY, now: NOW_14, draftId: "0".repeat(32) })).toEqual({ ok: true });
    expect(await sourceOn(TODAY)).toBe("manual");
    expect(await saveClose(ahmed(), full(), { today: TODAY, now: NOW_14, draftId: "' or 1=1 --" })).toEqual({ ok: true });
    expect(await sourceOn(TODAY)).toBe("manual");
  });

  it("a receipt adds no trust: the form is validated exactly as before and the receipt is not spent on a refusal", async () => {
    const id = await createDraftReceipt(ahmed(), { date: TODAY, source: "voice", fileId: null }, NOW_14);
    const bad = full();
    bad.lines = { ...bad.lines, bev: -1, zzz: 5 };
    expect(await saveClose(ahmed(), bad, { today: TODAY, now: NOW_14, draftId: id })).toEqual({
      ok: false,
      errors: { "lines.bev": "negative", "lines.zzz": "unknown" },
    });
    expect((await receipt(id)).usedAt).toBeNull();
    expect(await sourceOn(TODAY)).toBeUndefined();
  });

  it("a save rolled back after the receipt was consumed leaves the receipt unused", async () => {
    const id = await createDraftReceipt(ahmed(), { date: TODAY, source: "voice", fileId: null }, NOW_14);
    await db.execute(sql`create function refuse_return() returns trigger language plpgsql as $$ begin raise exception 'forced'; end $$`);
    await db.execute(sql`create trigger refuse_return before insert on returns for each row execute function refuse_return()`);
    const withReturn = full();
    withReturn.returns = [{ description: "x", quantity: 1, reason: "expired" }];
    await expect(saveClose(ahmed(), withReturn, { today: TODAY, now: NOW_14, draftId: id })).rejects.toThrow();
    expect((await receipt(id)).usedAt).toBeNull();
    expect(await sourceOn(TODAY)).toBeUndefined();
  });

  it("an admin-recorded collection line that differs from the rep's keeps the collections invariant with a receipt", async () => {
    await db.insert(s.dailyCloses).values({ id: "upl-c", companyId: seed.companyId, userId: "ahmed", date: TODAY, source: "excel", status: "draft" });
    await db.insert(s.closeLines).values({ id: "upl-c-coll", companyId: seed.companyId, closeId: "upl-c", lineId: "coll", amount: 2_000_000, source: "excel", repAmount: null });
    const id = await createDraftReceipt(ahmed(), { date: TODAY, source: "voice", fileId: null }, NOW_14);
    expect(await saveClose(ahmed(), full(), { today: TODAY, now: NOW_14, draftId: id })).toEqual({ ok: true });
    const [close] = await db.select().from(s.dailyCloses).where(eq(s.dailyCloses.id, "upl-c"));
    expect(close).toMatchObject({ source: "voice", status: "confirmed", collections: 2_000_000 });
    const [coll] = await db.select().from(s.closeLines).where(and(eq(s.closeLines.closeId, "upl-c"), eq(s.closeLines.lineId, "coll")));
    expect(coll).toMatchObject({ amount: 2_000_000, repAmount: 1_950_000 });
  });

  it("two saves racing with one receipt: it is consumed exactly once", async () => {
    const id = await createDraftReceipt(ahmed(), { date: TODAY, source: "voice", fileId: null }, NOW_14);
    const hits = await Promise.all([1, 2].map(() => db.transaction((tx) => consumeDraftReceipt(tx as unknown as Db, ahmed(), { id, date: TODAY }, NOW_14))));
    expect(hits.filter((h) => h !== null)).toEqual([{ source: "voice", fileId: null }]);
  });

  describe("a photo receipt", () => {
    let root: string;
    let store: FileStore;
    beforeEach(async () => {
      root = await mkdtemp(path.join(tmpdir(), "close-receipt-"));
      store = localStore(root);
    });
    afterEach(async () => {
      await rm(root, { recursive: true, force: true });
    });
    async function reportPhoto(): Promise<string> {
      const jpeg = new Uint8Array(await sharp({ create: { width: 64, height: 48, channels: 3, background: { r: 9, g: 9, b: 9 } } }).jpeg().toBuffer());
      const r = await saveUpload(ahmed(), { kind: "report", date: TODAY, bytes: jpeg }, { store, today: TODAY, now: NOW_14 });
      if (!r.ok) throw new Error(r.error);
      return r.id;
    }

    it("attaches the report photo to the close", async () => {
      const fileId = await reportPhoto();
      const id = await createDraftReceipt(ahmed(), { date: TODAY, source: "photo", fileId }, NOW_14);
      expect(await saveClose(ahmed(), full(), { today: TODAY, now: NOW_14, draftId: id })).toEqual({ ok: true });
      const [f] = await db.select().from(s.files).where(eq(s.files.id, fileId));
      const [close] = await db.select().from(s.dailyCloses).where(and(eq(s.dailyCloses.userId, "ahmed"), eq(s.dailyCloses.date, TODAY)));
      expect(f).toMatchObject({ closeId: close!.id, kind: "report", deletedAt: null, returnPos: null });
      expect(close!.source).toBe("photo");
      // Re-saving the close (return photos are synced) leaves the report photo attached.
      expect(await saveClose(ahmed(), full(), { today: TODAY, now: NOW_14 })).toEqual({ ok: true });
      const [again] = await db.select().from(s.files).where(eq(s.files.id, fileId));
      expect(again).toMatchObject({ closeId: close!.id, deletedAt: null });
    });

    it("a report photo removed meanwhile: the close is still saved as photo, the photo stays unattached", async () => {
      const logged = vi.spyOn(console, "error").mockImplementation(() => {});
      const fileId = await reportPhoto();
      const id = await createDraftReceipt(ahmed(), { date: TODAY, source: "photo", fileId }, NOW_14);
      expect(await removeOwnFile(ahmed(), fileId)).toEqual({ ok: true });
      expect(await saveClose(ahmed(), full(), { today: TODAY, now: NOW_14, draftId: id })).toEqual({ ok: true });
      expect(await sourceOn(TODAY)).toBe("photo");
      const [f] = await db.select().from(s.files).where(eq(s.files.id, fileId));
      expect(f!.closeId).toBeNull();
      expect(logged).toHaveBeenCalledWith("report photo not attached: gone before the close was confirmed");
      logged.mockRestore();
    });

    it("a newer report photo on the same close soft-deletes the earlier one (R74)", async () => {
      const first = await reportPhoto();
      const r1 = await createDraftReceipt(ahmed(), { date: TODAY, source: "photo", fileId: first }, NOW_14);
      expect(await saveClose(ahmed(), full(), { today: TODAY, now: NOW_14, draftId: r1 })).toEqual({ ok: true });
      const second = await reportPhoto();
      const r2 = await createDraftReceipt(ahmed(), { date: TODAY, source: "photo", fileId: second }, NOW_14);
      expect(await saveClose(ahmed(), full(), { today: TODAY, now: NOW_14, draftId: r2 })).toEqual({ ok: true });
      const rows = await db.select().from(s.files).where(eq(s.files.kind, "report"));
      const byId = new Map(rows.map((r) => [r.id, r]));
      expect(byId.get(first)!.deletedAt).not.toBeNull();
      expect(byId.get(second)).toMatchObject({ deletedAt: null });
      expect(byId.get(second)!.closeId).toBe(byId.get(first)!.closeId);
      // A typed re-save without a receipt leaves the current report photo alone.
      expect(await saveClose(ahmed(), full(), { today: TODAY, now: NOW_14 })).toEqual({ ok: true });
      expect((await db.select().from(s.files).where(eq(s.files.id, second)))[0]!.deletedAt).toBeNull();
    });
  });
});

describe("sweepDrafts (R28, R59)", () => {
  const T = new Date("2026-11-14T07:00:00Z");
  it("deletes receipts whose expiry is at least 24 hours past, across companies, and returns the count", async () => {
    const old = await createDraftReceipt(ahmed(), { date: "2026-11-12", source: "voice", fileId: null }, new Date(T.getTime() - 48 * 3_600_000));
    const young = await createDraftReceipt(ahmed(), { date: "2026-11-12", source: "voice", fileId: null }, new Date(T.getTime() - 47 * 3_600_000));
    const fresh = await createDraftReceipt(ahmed(), { date: TODAY, source: "voice", fileId: null }, T);
    const other = await createDraftReceipt(await otherRep(), { date: TODAY, source: "voice", fileId: null }, new Date(T.getTime() - 72 * 3_600_000));
    expect(await sweepDrafts(db, T)).toBe(2);
    const left = (await db.select({ id: s.aiDrafts.id }).from(s.aiDrafts)).map((r) => r.id).sort();
    expect(left).toEqual([young, fresh].sort());
    expect(left).not.toContain(old);
    expect(left).not.toContain(other);
    expect(await sweepDrafts(db, T)).toBe(0);
  });

  it("a receipt's file can be deleted: file_id becomes null (ON DELETE SET NULL)", async () => {
    await db.insert(s.files).values({
      id: "f".repeat(32),
      companyId: seed.companyId,
      userId: "ahmed",
      kind: "report",
      date: TODAY,
      storageKey: `demo-co/ahmed/${TODAY}/report-${"f".repeat(32)}.jpg`,
      bytes: 1,
      width: 1,
      height: 1,
    });
    const id = await createDraftReceipt(ahmed(), { date: TODAY, source: "photo", fileId: "f".repeat(32) }, T);
    await db.delete(s.files).where(eq(s.files.id, "f".repeat(32)));
    expect((await db.select().from(s.aiDrafts).where(eq(s.aiDrafts.id, id)))[0]!.fileId).toBeNull();
  });

  it("createDraftReceipt refuses a repCtx context", async () => {
    const tagged = await repCtx({ ...ahmed(), userId: seed.supervisorId, role: "supervisor" }, "ahmed");
    await expect(createDraftReceipt(tagged!, { date: TODAY, source: "voice", fileId: null }, T)).rejects.toThrow(Forbidden);
  });
});
