import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { createTestDb } from "@/db/testing";
import { seedDemo, type SeedResult } from "@/db/seed";
import type { Db } from "@/db/client";
import * as s from "@/db/schema";
import type { Ctx } from "@/server/ctx";
import { Forbidden, type Role } from "@/server/auth/roles";
import { getMonthView } from "@/server/repos/month-view";
import { getClose, saveClose, type CloseForm } from "@/server/repos/closes";
import { getHistoryDays } from "@/server/repos/history";
import { reconcile } from "@/domain/reconciliation";
import { UPLOAD_MAX_BYTES, listUploads, processUpload, readUploadFile, rejectUpload, singleFlight } from "./uploads";

const TODAY = "2026-11-14";
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

const DAILY_HEADER = ["login", "date", "line", "amount"];
const TARGET_HEADER = ["login", "year", "month", "line", "amount"];

async function xlsx(rows: unknown[][]): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  const sheet = wb.addWorksheet("data");
  for (const r of rows) sheet.addRow(r as ExcelJS.CellValue[]);
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}
const daily = async (...rows: unknown[][]) => ({ kind: "daily" as const, filename: "daily.xlsx", data: await xlsx([DAILY_HEADER, ...rows]) });
const targets = async (...rows: unknown[][]) => ({ kind: "targets" as const, filename: "targets.xlsx", data: await xlsx([TARGET_HEADER, ...rows]) });

function form(date: string, lines: Record<string, number>, extra: Partial<CloseForm> = {}): CloseForm {
  return { date, lines, focus: {}, cashSales: 0, creditSales: 0, collections: 0, expenses: 0, loaded: 0, sold: 0, returned: 0, returns: [], note: "", ...extra };
}

const closeLine = async (userId: string, date: string, lineId: string) => {
  const [row] = await db
    .select({ amount: s.closeLines.amount, source: s.closeLines.source, repAmount: s.closeLines.repAmount })
    .from(s.closeLines)
    .innerJoin(s.dailyCloses, eq(s.closeLines.closeId, s.dailyCloses.id))
    .where(and(eq(s.dailyCloses.userId, userId), eq(s.dailyCloses.date, date), eq(s.closeLines.lineId, lineId)));
  return row;
};
const closesOf = (userId: string, date: string) =>
  db.select().from(s.dailyCloses).where(and(eq(s.dailyCloses.userId, userId), eq(s.dailyCloses.date, date)));
const bevAchieved = async () => (await getMonthView(ahmed(), { year: 2026, month: 11, today: TODAY })).lines.find((l) => l.lineId === "bev")!.achieved;
const allUploads = () => db.select().from(s.uploads);

async function snapshot() {
  const lines = (await db.select().from(s.closeLines)).map((l) => ({ ...l, updatedAt: null }));
  const closes = (await db.select().from(s.dailyCloses)).map((c) => ({ ...c, updatedAt: null }));
  const changes = await db.select().from(s.targetChanges);
  const targetRows = (await db.select().from(s.targets)).map((t) => ({ ...t, updatedAt: null }));
  const by = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id);
  return { lines: lines.sort(by), closes: closes.sort(by), changes: changes.sort(by), targetRows: targetRows.sort(by) };
}

describe("daily upload", () => {
  it("excel wins over the rep: Ahmed's bev 106 becomes 120 and his value is kept in rep_amount", async () => {
    expect(await bevAchieved()).toBe(1140);
    const r = await processUpload(admin(), await daily(["ahmed", "2026-11-12", "bev", 120]), { today: TODAY });
    expect(r).toMatchObject({ applied: true, rows: 1, errors: [] });
    expect(await bevAchieved()).toBe(1154);
    expect(await closeLine("ahmed", "2026-11-12", "bev")).toEqual({ amount: 120, source: "excel", repAmount: 106 });
    const [up] = await allUploads();
    expect(up).toMatchObject({ kind: "daily", filename: "daily.xlsx", rowCount: 1, errorCount: 0, applied: true, uploadedBy: seed.adminId, companyId: "demo-co" });
    expect(r.uploadId).toBe(up!.id);
  });

  it("the rep's re-save keeps the admin amount and moves his typed value to rep_amount", async () => {
    await processUpload(admin(), await daily(["ahmed", "2026-11-12", "bev", 120]), { today: TODAY });
    const before = await getClose(ahmed(), "2026-11-12");
    expect(await saveClose(ahmed(), form("2026-11-12", { ...before!.lines, bev: 110 }), { today: TODAY })).toEqual({ ok: true });
    expect(await closeLine("ahmed", "2026-11-12", "bev")).toEqual({ amount: 120, source: "excel", repAmount: 110 });
    const after = await getClose(ahmed(), "2026-11-12");
    expect(after!.lines.bev).toBe(120);
    expect(after!.admin).toEqual({ bev: { amount: 120, repAmount: 110 } });
    expect(await bevAchieved()).toBe(1154);
    // The rep's other lines are his own and stay editable.
    expect(await saveClose(ahmed(), form("2026-11-12", { ...after!.lines, food: 700_000 }), { today: TODAY })).toEqual({ ok: true });
    expect(await closeLine("ahmed", "2026-11-12", "food")).toMatchObject({ amount: 700_000, source: "rep" });
  });

  it("marks the line in the rep's history day", async () => {
    await processUpload(admin(), await daily(["ahmed", "2026-11-12", "bev", 120]), { today: TODAY });
    const days = await getHistoryDays(ahmed(), 2026, 11);
    expect(days[0]).toMatchObject({ date: "2026-11-12", lines: { bev: 120 }, admin: { bev: { amount: 120, repAmount: 106 } } });
  });

  it("creates a draft excel close with zero money and collections from the collection lines", async () => {
    const r = await processUpload(admin(), await daily(["khaled", "2026-11-14", "coll", 15000], ["khaled", "2026-11-14", "bev", 40]), { today: TODAY });
    expect(r.applied).toBe(true);
    const [close] = await closesOf("khaled", "2026-11-14");
    expect(close).toMatchObject({ source: "excel", status: "draft", collections: 1_500_000, cashSales: 0, creditSales: 0, expenses: 0, loaded: 0, sold: 0, returned: 0 });
    expect(await closeLine("khaled", "2026-11-14", "coll")).toEqual({ amount: 1_500_000, source: "excel", repAmount: null });
    // The rep opens the excel-created close and fills in cash: the admin amounts stay.
    const khaled = ctxOf("khaled", "rep");
    const saved = await getClose(khaled, "2026-11-14");
    expect(saved!.admin.bev).toEqual({ amount: 40, repAmount: null });
    expect(await saveClose(khaled, form("2026-11-14", { bev: 55, coll: 1_500_000, food: 0 }, { cashSales: 900_000, collections: 1_500_000 }), { today: TODAY })).toEqual({ ok: true });
    const [after] = await closesOf("khaled", "2026-11-14");
    expect(after).toMatchObject({ source: "manual", cashSales: 900_000, collections: 1_500_000 });
    expect(await closeLine("khaled", "2026-11-14", "bev")).toEqual({ amount: 40, source: "excel", repAmount: 55 });
  });

  it("keeps the close's collections equal to its collection lines when the upload changes one", async () => {
    const [was] = await closesOf("ahmed", "2026-11-12");
    await processUpload(admin(), await daily(["ahmed", "2026-11-12", "coll", 20000]), { today: TODAY });
    const [close] = await closesOf("ahmed", "2026-11-12");
    expect(close!.collections).toBe(2_000_000);
    expect({ ...close, collections: 0, updatedAt: null }).toEqual({ ...was, collections: 0, updatedAt: null });
  });

  it("one bad row applies nothing, and the report is stored", async () => {
    const before = await snapshot();
    const r = await processUpload(
      admin(),
      await daily(["ahmed", "2026-11-12", "bev", 120], ["ahmed", "2026-11-11", "bev", 99], ["ahmed", "2026-11-10", "nope", 5]),
      { today: TODAY },
    );
    expect(r).toMatchObject({ applied: false, rows: 3, errors: [{ row: 4, column: "line", code: "unknown_line" }] });
    expect(await snapshot()).toEqual(before);
    const [up] = await allUploads();
    expect(up).toMatchObject({ applied: false, errorCount: 1, rowCount: 3, errors: [{ row: 4, column: "line", code: "unknown_line" }] });
  });

  it("another company's rep login is unknown_rep and nothing changes in either company", async () => {
    const before = await snapshot();
    const r = await processUpload(admin(), await daily(["other-rep", "2026-11-12", "bev", 5]), { today: TODAY });
    expect(r.applied).toBe(false);
    expect(r.errors).toEqual([{ row: 2, column: "login", code: "unknown_rep" }]);
    expect(await snapshot()).toEqual(before);
  });

  it("an admin's own login and an inactive rep are unknown_rep", async () => {
    await db.update(s.users).set({ active: false }).where(eq(s.users.id, "omar"));
    const r = await processUpload(admin(), await daily(["admin@demo.test", "2026-11-12", "bev", 5], ["omar", "2026-11-12", "bev", 5]), { today: TODAY });
    expect(r.errors.map((e) => e.code)).toEqual(["unknown_rep", "unknown_rep"]);
  });

  it("the same file twice gives identical amounts and one close per day", async () => {
    const file = await daily(["ahmed", "2026-11-12", "bev", 120], ["khaled", "2026-11-14", "coll", 15000], ["khaled", "2026-11-14", "bev", 3]);
    await processUpload(admin(), file, { today: TODAY });
    const once = await snapshot();
    const r2 = await processUpload(admin(), file, { today: TODAY });
    expect(r2.applied).toBe(true);
    const twice = await snapshot();
    expect(twice.lines).toEqual(once.lines);
    expect(twice.closes).toEqual(once.closes);
    expect(await closesOf("khaled", "2026-11-14")).toHaveLength(1);
    expect(await allUploads()).toHaveLength(2);
  });

  it("future dates and non-selling days are reported, not applied", async () => {
    const r = await processUpload(admin(), await daily(["ahmed", "2026-11-20", "bev", 1], ["ahmed", "2026-11-13", "bev", 1]), { today: TODAY });
    expect(r.errors.map((e) => e.code)).toEqual(["future_date", "not_selling_day"]);
  });

  it("an upload and the rep saving the same close at once leave a consistent state", async () => {
    const file = await daily(["ahmed", "2026-11-12", "bev", 120], ["ahmed", "2026-11-12", "coll", 20000]);
    const before = await getClose(ahmed(), "2026-11-12");
    const [r, saved] = await Promise.all([
      processUpload(admin(), file, { today: TODAY }),
      saveClose(ahmed(), form("2026-11-12", { ...before!.lines, bev: 110 }, { cashSales: 50_000, expenses: 1_000 }), { today: TODAY }),
    ]);
    expect(r.applied).toBe(true);
    expect(saved).toEqual({ ok: true });
    const closes = await closesOf("ahmed", "2026-11-12");
    expect(closes).toHaveLength(1);
    expect(await closeLine("ahmed", "2026-11-12", "bev")).toMatchObject({ amount: 120, source: "excel" });
    expect(await closeLine("ahmed", "2026-11-12", "coll")).toMatchObject({ amount: 2_000_000, source: "excel" });
    expect(closes[0]!.collections).toBe(2_000_000);
    // The rep's cash and expenses are never the upload's to change.
    expect(closes[0]).toMatchObject({ cashSales: 50_000, expenses: 1_000 });
    const lines = await db.select().from(s.closeLines).where(eq(s.closeLines.closeId, closes[0]!.id));
    expect(new Set(lines.map((l) => l.lineId)).size).toBe(lines.length);
  });

  it("two uploads for a day nobody has closed create one close", async () => {
    const a = await daily(["omar", "2026-11-14", "bev", 5]);
    const b = await daily(["omar", "2026-11-14", "food", 700]);
    const [ra, rb] = await Promise.all([processUpload(admin(), a, { today: TODAY }), processUpload(admin(), b, { today: TODAY })]);
    expect([ra.applied, rb.applied]).toEqual([true, true]);
    expect(await closesOf("omar", "2026-11-14")).toHaveLength(1);
  });
});

describe("targets upload", () => {
  it("sets the target and logs one change per row with source excel and the upload id", async () => {
    const r = await processUpload(admin(), await targets(["ahmed", 2026, 11, "bev", 3300]), { today: TODAY });
    expect(r).toMatchObject({ applied: true, rows: 1, errors: [] });
    const [t] = await db.select().from(s.targets).where(and(eq(s.targets.userId, "ahmed"), eq(s.targets.lineId, "bev"), eq(s.targets.month, 11)));
    expect(t!.amount).toBe(3300);
    const changes = await db.select().from(s.targetChanges);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ source: "excel", uploadId: r.uploadId, oldAmount: 3000, newAmount: 3300, changedBy: seed.adminId });
  });

  it("the same file again adds no change rows", async () => {
    const file = await targets(["ahmed", 2026, 11, "bev", 3300]);
    await processUpload(admin(), file, { today: TODAY });
    const r2 = await processUpload(admin(), file, { today: TODAY });
    expect(r2.applied).toBe(true);
    expect(await db.select().from(s.targetChanges)).toHaveLength(1);
  });

  it("several months in one file are all applied, in ascending month order", async () => {
    const r = await processUpload(
      admin(),
      await targets(["ahmed", 2027, 1, "bev", 10], ["ahmed", 2026, 12, "bev", 20], ["ahmed", 2026, 11, "bev", 30]),
      { today: TODAY },
    );
    expect(r.applied).toBe(true);
    const rows = await db.select().from(s.targetChanges);
    expect(rows.map((c) => `${c.year}-${c.month}`).sort()).toEqual(["2026-11", "2026-12", "2027-1"]);
  });

  it("a bad row applies none of the targets", async () => {
    const before = await snapshot();
    const r = await processUpload(admin(), await targets(["ahmed", 2026, 11, "bev", 3300], ["ahmed", 2026, 13, "bev", 5]), { today: TODAY });
    expect(r.applied).toBe(false);
    expect(r.errors).toEqual([{ row: 3, column: "month", code: "invalid_period" }]);
    expect(await snapshot()).toEqual(before);
  });
});

describe("read errors and the record", () => {
  it("a renamed text file is not_xlsx and still leaves an uploads row", async () => {
    const data = new TextEncoder().encode("login,date,line,amount\nahmed,2026-11-12,bev,120\n");
    const r = await processUpload(admin(), { kind: "daily", filename: "daily.xlsx", data: data.buffer as ArrayBuffer }, { today: TODAY });
    expect(r).toMatchObject({ applied: false, rows: 0, errors: [], readError: "not_xlsx" });
    expect(await allUploads()).toMatchObject([{ applied: false, rowCount: 0, errorCount: 0, filename: "daily.xlsx" }]);
  });

  it("missing columns and duplicate columns come back with their names", async () => {
    const missing = await processUpload(admin(), { kind: "daily", filename: "a.xlsx", data: await xlsx([["login", "date"], ["ahmed", "2026-11-12"]]) }, { today: TODAY });
    expect(missing).toMatchObject({ readError: "missing_columns", missing: ["line", "amount"] });
    const dup = await processUpload(admin(), { kind: "daily", filename: "b.xlsx", data: await xlsx([["login", "login", "date", "line", "amount"], ["a", "b", "2026-11-12", "bev", 1]]) }, { today: TODAY });
    expect(dup).toMatchObject({ readError: "duplicate_columns", duplicates: ["login"] });
  });

  it("a header-only file is empty", async () => {
    const r = await processUpload(admin(), await daily(), { today: TODAY });
    expect(r).toMatchObject({ applied: false, readError: "empty" });
  });

  it("more than 5,000 rows is too_many_rows, applied never", async () => {
    const rows = Array.from({ length: 5001 }, () => ["ahmed", "2026-11-12", "bev", 1]);
    const r = await processUpload(admin(), await daily(...rows), { today: TODAY });
    expect(r).toMatchObject({ applied: false });
    expect(r.errors).toEqual([{ row: 0, code: "too_many_rows" }]);
  });

  it("stores at most 200 errors but counts them all", async () => {
    const rows = Array.from({ length: 300 }, () => ["ghost", "2026-11-12", "bev", 1]);
    const r = await processUpload(admin(), await daily(...rows), { today: TODAY });
    expect(r.applied).toBe(false);
    const [up] = await allUploads();
    expect(up!.errorCount).toBe(300);
    expect(up!.errors).toHaveLength(200);
  });

  it("a file over 2 MB is too_large even when it reaches processUpload", async () => {
    const r = await processUpload(admin(), { kind: "daily", filename: "big.xlsx", data: new ArrayBuffer(UPLOAD_MAX_BYTES + 1) }, { today: TODAY });
    expect(r).toMatchObject({ applied: false, readError: "too_large" });
    expect(await allUploads()).toHaveLength(1);
  });

  it("a failed apply rolls back every row but keeps the record", async () => {
    const before = await snapshot();
    // A line deactivated between reading and applying cannot be simulated here, so force a failure
    // at the first write of the transaction.
    const ctx = admin();
    const real = ctx.db.transaction.bind(ctx.db);
    const failing = { ...ctx, db: Object.assign(Object.create(ctx.db), { transaction: async (fn: (tx: never) => Promise<unknown>) => real(async (tx) => { await fn(tx as never); throw new Error("boom"); }) }) } as Ctx;
    await expect(processUpload(failing, await daily(["ahmed", "2026-11-12", "bev", 120]), { today: TODAY })).rejects.toThrow("boom");
    expect(await snapshot()).toEqual(before);
    expect(await allUploads()).toMatchObject([{ applied: false, errorCount: 0 }]);
  });
});

describe("roles and listing", () => {
  it("every function refuses a non-admin", async () => {
    const rep = ahmed();
    await expect(processUpload(rep, await daily(["ahmed", "2026-11-12", "bev", 1]), { today: TODAY })).rejects.toBeInstanceOf(Forbidden);
    await expect(rejectUpload(rep, { kind: "daily", filename: "x" }, "too_large")).rejects.toBeInstanceOf(Forbidden);
    await expect(listUploads(rep, { limit: 5 })).rejects.toBeInstanceOf(Forbidden);
    expect(await allUploads()).toHaveLength(0);
  });

  it("lists the caller's company only, newest first, with the uploader's name", async () => {
    await processUpload(admin(), await daily(["ahmed", "2026-11-12", "bev", 120]), { today: TODAY });
    await processUpload(admin(), await daily(["ghost", "2026-11-12", "bev", 1]), { today: TODAY });
    await db.insert(s.users).values({ id: "other-admin", companyId: "other-co", role: "admin", name: "Other Admin", login: "admin@other.test" });
    await processUpload(ctxOf("other-admin", "admin", "other-co"), { kind: "daily", filename: "o.xlsx", data: await xlsx([DAILY_HEADER, ["other-rep", "2026-11-12", "other-line", 1]]) }, { today: TODAY });
    const mine = await listUploads(admin(), { limit: 10 });
    expect(mine).toHaveLength(2);
    expect(mine.map((u) => [u.applied, u.errorCount, u.rows])).toEqual([[false, 1, 1], [true, 0, 1]]);
    expect(mine[0]).toMatchObject({ kind: "daily", filename: "daily.xlsx", byName: expect.any(String) });
    const theirs = await listUploads(ctxOf("other-admin", "admin", "other-co"), { limit: 10 });
    expect(theirs).toHaveLength(1);
    expect(await listUploads(admin(), { limit: 0 })).toHaveLength(1);
  });
});

describe("size guard and single flight", () => {
  it("rejects a file over the limit before reading its bytes", async () => {
    const arrayBuffer = vi.fn(async () => new ArrayBuffer(8));
    const r = await readUploadFile({ size: UPLOAD_MAX_BYTES + 1, name: "big.xlsx", arrayBuffer });
    expect(r).toEqual({ ok: false, error: "too_large" });
    expect(arrayBuffer).not.toHaveBeenCalled();
    const ok = await readUploadFile({ size: 8, name: "ok.xlsx", arrayBuffer });
    expect(ok.ok).toBe(true);
    expect(arrayBuffer).toHaveBeenCalledTimes(1);
    expect(await readUploadFile({ size: 0, name: "empty.xlsx", arrayBuffer })).toEqual({ ok: false, error: "empty" });
  });

  it("refuses a second run for the same key while the first is running, then frees it", async () => {
    let release!: () => void;
    const first = singleFlight("admin-1", () => new Promise<string>((res) => { release = () => res("done"); }));
    expect(await singleFlight("admin-1", async () => "second")).toEqual({ busy: true });
    expect(await singleFlight("admin-2", async () => "other")).toEqual({ busy: false, value: "other" });
    release();
    expect(await first).toEqual({ busy: false, value: "done" });
    expect(await singleFlight("admin-1", async () => "again")).toEqual({ busy: false, value: "again" });
  });

  it("frees the key when the work throws", async () => {
    await expect(singleFlight("admin-3", async () => { throw new Error("x"); })).rejects.toThrow("x");
    expect(await singleFlight("admin-3", async () => 1)).toEqual({ busy: false, value: 1 });
  });
});

describe("fix round 1: drafts, collections, rep_amount, revalidation", () => {
  const khaled = () => ctxOf("khaled", "rep");

  it("R16: an upload-created close is a draft, an open day; the rep's save confirms it", async () => {
    await processUpload(admin(), await daily(["khaled", "2026-11-14", "bev", 40]), { today: TODAY });
    const [close] = await closesOf("khaled", "2026-11-14");
    expect(close).toMatchObject({ status: "draft", source: "excel" });
    expect((await getClose(khaled(), "2026-11-14"))!.draft).toBe(true);
    const view = await getMonthView(khaled(), { year: 2026, month: 11, today: TODAY });
    expect(view.hasClosedToday).toBe(false);
    // the amount still counts toward the month, but the calendar day is not marked done
    const bev = view.lines.find((l) => l.lineId === "bev")!;
    expect(bev.achieved).toBe(1320 + 40);
    expect(bev.days.find((d) => d.date === "2026-11-14")!.amount).toBeNull();
    const days = await getHistoryDays(khaled(), 2026, 11);
    expect(days.find((d) => d.date === "2026-11-14")).toMatchObject({ draft: true, admin: { bev: { amount: 40, repAmount: null } } });
    expect(await saveClose(khaled(), form("2026-11-14", { bev: 40, food: 0, coll: 0 }), { today: TODAY })).toEqual({ ok: true });
    expect((await closesOf("khaled", "2026-11-14"))[0]!.status).toBe("confirmed");
    expect((await getClose(khaled(), "2026-11-14"))!.draft).toBe(false);
    expect((await getMonthView(khaled(), { year: 2026, month: 11, today: TODAY })).hasClosedToday).toBe(true);
    expect((await getHistoryDays(khaled(), 2026, 11)).find((d) => d.date === "2026-11-14")!.draft).toBe(false);
  });

  it("an upload to an already confirmed close leaves it confirmed", async () => {
    await processUpload(admin(), await daily(["ahmed", "2026-11-12", "bev", 120]), { today: TODAY });
    expect((await closesOf("ahmed", "2026-11-12"))[0]!.status).toBe("confirmed");
  });

  it("R17: cash to hand over equals the stored collections after an upload and a save", async () => {
    await processUpload(admin(), await daily(["khaled", "2026-11-14", "coll", 15000]), { today: TODAY });
    const [c] = await closesOf("khaled", "2026-11-14");
    expect(c!.collections).toBe(1_500_000);
    expect(reconcile(c!).cashToHandOver).toBe(1_500_000);
    const saved = await getClose(khaled(), "2026-11-14");
    expect(saved!.collections).toBe(1_500_000);
    expect(saved!.admin.coll).toEqual({ amount: 1_500_000, repAmount: null });
    await saveClose(khaled(), form("2026-11-14", { coll: 1_500_000, bev: 0, food: 0 }, { cashSales: 200_000, collections: 1_500_000 }), { today: TODAY });
    const [after] = await closesOf("khaled", "2026-11-14");
    expect(reconcile(after!).cashToHandOver).toBe(1_700_000);
  });

  it("R18: a rep who clears an admin-set collection field keeps the admin amount and collections follow the stored lines", async () => {
    await processUpload(admin(), await daily(["ahmed", "2026-11-12", "coll", 20000]), { today: TODAY });
    const before = await getClose(ahmed(), "2026-11-12");
    await saveClose(ahmed(), form("2026-11-12", { ...before!.lines, coll: 0 }, { collections: 0 }), { today: TODAY });
    expect(await closeLine("ahmed", "2026-11-12", "coll")).toMatchObject({ amount: 2_000_000, source: "excel", repAmount: 0 });
    expect((await closesOf("ahmed", "2026-11-12"))[0]!.collections).toBe(2_000_000);
    // a save that does not post the collection line at all
    await saveClose(ahmed(), form("2026-11-12", { bev: 106 }, { collections: 5 }), { today: TODAY });
    expect((await closesOf("ahmed", "2026-11-12"))[0]!.collections).toBe(2_000_000);
  });

  it("a second upload with a different value updates the amount and keeps the rep's 106", async () => {
    await processUpload(admin(), await daily(["ahmed", "2026-11-12", "bev", 120]), { today: TODAY });
    await processUpload(admin(), await daily(["ahmed", "2026-11-12", "bev", 125]), { today: TODAY });
    expect(await closeLine("ahmed", "2026-11-12", "bev")).toEqual({ amount: 125, source: "excel", repAmount: 106 });
  });

  it("a re-save that leaves the admin value untouched does not set rep_amount", async () => {
    await processUpload(admin(), await daily(["khaled", "2026-11-14", "bev", 40]), { today: TODAY });
    await saveClose(khaled(), form("2026-11-14", { bev: 40 }), { today: TODAY });
    expect(await closeLine("khaled", "2026-11-14", "bev")).toEqual({ amount: 40, source: "excel", repAmount: null });
    // and with a previous rep value, an untouched admin-equal post keeps it
    await processUpload(admin(), await daily(["ahmed", "2026-11-12", "bev", 120]), { today: TODAY });
    await saveClose(ahmed(), form("2026-11-12", { bev: 120 }), { today: TODAY });
    expect(await closeLine("ahmed", "2026-11-12", "bev")).toEqual({ amount: 120, source: "excel", repAmount: 106 });
  });

  it("re-validates inside the transaction: a rep deactivated meanwhile is not written, and the report is kept", async () => {
    const before = await snapshot();
    const ctx = admin();
    const real = ctx.db.transaction.bind(ctx.db);
    const racing = {
      ...ctx,
      db: Object.assign(Object.create(ctx.db), {
        transaction: async (fn: (tx: never) => Promise<unknown>) => {
          await db.update(s.users).set({ active: false }).where(eq(s.users.id, "ahmed"));
          return real(fn as never);
        },
      }),
    } as Ctx;
    const r = await processUpload(racing, await daily(["ahmed", "2026-11-12", "bev", 120]), { today: TODAY });
    expect(r).toMatchObject({ applied: false, errors: [{ row: 2, column: "login", code: "unknown_rep" }] });
    expect(await snapshot()).toEqual(before);
    expect(await allUploads()).toMatchObject([{ applied: false, errorCount: 1 }]);
  });

  it("strips direction and zero-width marks from stored filenames", async () => {
    await processUpload(admin(), { ...(await daily(["ahmed", "2026-11-12", "bev", 120])), filename: "a\u202Eb\u200Bc\u2066d.xlsx" }, { today: TODAY });
    expect((await allUploads())[0]!.filename).toBe("abcd.xlsx");
  });
});

describe("amount cap in an upload (A5)", () => {
  it("1e11 + 1 halalas in a targets file is a row error with nothing written, never a throw", async () => {
    const before = await snapshot();
    const r = await processUpload(admin(), await targets(["ahmed", 2026, 11, "food", "1000000000.01"]), { today: TODAY });
    expect(r).toMatchObject({ applied: false, errors: [{ row: 2, column: "amount", code: "invalid_amount" }] });
    expect(await snapshot()).toEqual(before);
  });
  it("1e11 + 1 cases in a daily file is refused the same way", async () => {
    const r = await processUpload(admin(), await daily(["ahmed", "2026-11-12", "bev", 100_000_000_001]), { today: TODAY });
    expect(r).toMatchObject({ applied: false, errors: [{ row: 2, column: "amount", code: "invalid_amount" }] });
  });
});

describe("float noise in an uploaded workbook (B1)", () => {
  it("a formula cell with a noisy cached result and a noisy plain number both apply", async () => {
    const formula = { formula: "0.1+0.2+8250", result: 8250.300000000001 };
    const r = await processUpload(
      admin(),
      await targets(["ahmed", 2026, 11, "food", formula], ["khaled", 2026, 11, "food", 0.1 + 0.2]),
      { today: TODAY },
    );
    expect(r).toMatchObject({ applied: true, rows: 2, errors: [] });
    const rows = await db.select().from(s.targets).where(and(eq(s.targets.lineId, "food"), eq(s.targets.year, 2026), eq(s.targets.month, 11)));
    const by = Object.fromEntries(rows.map((x) => [x.userId, x.amount]));
    expect(by.ahmed).toBe(825030);
    expect(by.khaled).toBe(30);
  });
});
