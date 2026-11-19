import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import * as s from "@/db/schema";
import { sellingDays, type ISODate } from "@/domain/calendar";
import {
  validateDailyRows,
  validateTargetRows,
  type DailyOp,
  type ImportLookup,
  type RowError,
  type TargetOp,
} from "@/domain/import/rows";
import { assertRole } from "@/server/auth/roles";
import type { Ctx } from "@/server/ctx";
import { readSheet, type ReadError, type SheetKind } from "@/server/import/xlsx";
import { currentDay } from "@/server/today";
import { normalizeText } from "@/domain/import/text";
import { applyTargets } from "./targets";

/** The largest file the upload action reads; readSheet keeps its own, larger guard as defence in depth. */
export const UPLOAD_MAX_BYTES = 2 * 1024 * 1024;
/** How many row errors are stored in `uploads.errors`; `error_count` always holds the full count. */
export const STORED_ERRORS = 200;
const FILENAME_MAX = 200;
const LIST_LIMIT_MAX = 100;

export type UploadInput = { kind: SheetKind; filename: string; data: ArrayBuffer };
export type UploadResult = {
  uploadId: string;
  applied: boolean;
  rows: number;
  errors: RowError[];
  readError?: ReadError;
  missing?: string[];
  duplicates?: string[];
};
export type UploadRow = {
  id: string;
  kind: SheetKind;
  filename: string;
  rows: number;
  errorCount: number;
  applied: boolean;
  createdAt: Date;
  byName: string;
};

const UPLOAD_ROLES = ["admin"] as const;
const REP_ROLES = ["rep", "supervisor"] as const;

/** The stored name: invisible direction and zero-width marks removed (they could reorder the name on screen), control characters turned to spaces. */
const cleanName = (name: string): string =>
  normalizeText(String(name).replace(/[\u0000-\u001f\u007f]/g, " ")).slice(0, FILENAME_MAX) || "file";

async function record(
  ctx: Ctx,
  v: { kind: SheetKind; filename: string; rowCount?: number; errorCount?: number; errors?: RowError[] },
): Promise<string> {
  const id = randomUUID();
  await ctx.db.insert(s.uploads).values({
    id,
    companyId: ctx.companyId,
    kind: v.kind,
    filename: cleanName(v.filename),
    rowCount: v.rowCount ?? 0,
    errorCount: v.errorCount ?? 0,
    applied: false,
    errors: (v.errors ?? []).slice(0, STORED_ERRORS),
    uploadedBy: ctx.userId,
  });
  return id;
}

/** Records a file that was refused before it was read (too big). Nothing else happens. */
export async function rejectUpload(
  ctx: Ctx,
  input: { kind: SheetKind; filename: string },
  readError: ReadError,
): Promise<UploadResult> {
  assertRole(ctx, UPLOAD_ROLES);
  const uploadId = await record(ctx, input);
  return { uploadId, applied: false, rows: 0, errors: [], readError };
}

type FileLike = { size: number; name: string; arrayBuffer: () => Promise<ArrayBuffer> };

/** The file's bytes, read only after its declared size passed the limit (an oversized file is never loaded). */
export async function readUploadFile(
  file: FileLike,
): Promise<{ ok: true; data: ArrayBuffer } | { ok: false; error: "too_large" | "empty" }> {
  if (file.size > UPLOAD_MAX_BYTES) return { ok: false, error: "too_large" };
  if (file.size === 0) return { ok: false, error: "empty" };
  const data = await file.arrayBuffer();
  // The declared size is the browser's word; the bytes are checked again.
  if (data.byteLength > UPLOAD_MAX_BYTES) return { ok: false, error: "too_large" };
  return { ok: true, data };
}

const running = new Set<string>();

/**
 * At most one run per key at a time inside this process. A second call while the first runs returns
 * `{ busy: true }` without running. This only protects one server instance: on serverless each
 * instance has its own set, so the database locks taken while applying are what keep two uploads
 * from interleaving.
 */
export async function singleFlight<T>(key: string, work: () => Promise<T>): Promise<{ busy: true } | { busy: false; value: T }> {
  if (running.has(key)) return { busy: true };
  running.add(key);
  try {
    return { busy: false, value: await work() };
  } finally {
    running.delete(key);
  }
}

async function loadLookup(ctx: Ctx): Promise<ImportLookup> {
  const [users, lines] = await Promise.all([
    ctx.db
      .select({ id: s.users.id, login: s.users.login })
      .from(s.users)
      .where(and(eq(s.users.companyId, ctx.companyId), eq(s.users.active, true), inArray(s.users.role, [...REP_ROLES]))),
    ctx.db
      .select({ id: s.targetLines.id, code: s.targetLines.code, unit: s.targetLines.unit, kind: s.targetLines.kind })
      .from(s.targetLines)
      .where(and(eq(s.targetLines.companyId, ctx.companyId), eq(s.targetLines.active, true))),
  ]);
  return {
    reps: new Map(users.map((u) => [u.login.toLowerCase(), u.id])),
    lines: new Map(lines.map((l) => [l.code.toLowerCase(), { id: l.id, unit: l.unit, kind: l.kind }])),
  };
}

async function sellingDayTest(ctx: Ctx): Promise<(d: ISODate) => boolean> {
  const [[company], holidays] = await Promise.all([
    ctx.db.select({ weekdays: s.companies.sellingWeekdays }).from(s.companies).where(eq(s.companies.id, ctx.companyId)),
    ctx.db.select({ date: s.holidays.date }).from(s.holidays).where(eq(s.holidays.companyId, ctx.companyId)),
  ]);
  if (!company) throw new Error("company not found");
  const off = holidays.map((h) => h.date);
  const months = new Map<string, Set<ISODate>>();
  return (d) => {
    const ym = d.slice(0, 7);
    let set = months.get(ym);
    if (!set) {
      set = new Set(sellingDays(Number(d.slice(0, 4)), Number(d.slice(5, 7)), company.weekdays, off));
      months.set(ym, set);
    }
    return set.has(d);
  };
}

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Reads an uploaded workbook and applies it, all or nothing: any row error and nothing is written.
 * The `uploads` row is written first and outside the apply transaction, so a refused or failed
 * upload still leaves its report; the same transaction that applies the rows flips it to `applied`.
 */
export async function processUpload(ctx: Ctx, input: UploadInput, opts?: { today?: ISODate }): Promise<UploadResult> {
  assertRole(ctx, UPLOAD_ROLES);
  const { kind } = input;
  if (input.data.byteLength > UPLOAD_MAX_BYTES) return rejectUpload(ctx, input, "too_large");

  const read = await readSheet(input.data, kind);
  if (!read.ok) {
    const uploadId = await record(ctx, input);
    return {
      uploadId,
      applied: false,
      rows: 0,
      errors: [],
      readError: read.error,
      ...(read.missing ? { missing: read.missing } : {}),
      ...(read.duplicates ? { duplicates: read.duplicates } : {}),
    };
  }

  const today = opts?.today ?? currentDay(ctx.timeZone);
  const check = async (c: Ctx) => {
    // Lookups come from the caller's company only; a login or line code of another company is unknown.
    const lookup = await loadLookup(c);
    const checked =
      kind === "targets"
        ? validateTargetRows(read.rows, lookup)
        : validateDailyRows(read.rows, { ...lookup, today, isSellingDay: await sellingDayTest(c) });
    return { lookup, ...checked };
  };
  const first = await check(ctx);
  const rows = read.rows.length;

  if (first.errors.length === 0 && first.ops.length === 0) {
    const uploadId = await record(ctx, input);
    return { uploadId, applied: false, rows: 0, errors: [], readError: "empty" };
  }
  // Task 17's validators return the good rows even when some are bad; none of them is ever applied then.
  if (first.errors.length > 0) {
    const uploadId = await record(ctx, { ...input, rowCount: rows, errorCount: first.errors.length, errors: first.errors });
    return { uploadId, applied: false, rows, errors: first.errors };
  }

  const uploadId = await record(ctx, { ...input, rowCount: rows });
  try {
    await ctx.db.transaction(async (t) => {
      const tx = t as unknown as Db;
      // One upload per company at a time, taken before any row lock so the order is the same everywhere.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`upload|${ctx.companyId}`}))`);
      // Checked again under the lock: a rep or line deactivated since the first pass is not written.
      const again = await check({ ...ctx, db: tx });
      if (again.errors.length > 0) throw new Rejected(again.errors);
      if (kind === "targets") await applyTargetOps(ctx, tx, again.ops as TargetOp[], uploadId);
      else await applyDailyOps(ctx, tx, again.ops as DailyOp[], again.lookup);
      await tx
        .update(s.uploads)
        .set({ applied: true })
        .where(and(eq(s.uploads.id, uploadId), eq(s.uploads.companyId, ctx.companyId)));
    });
  } catch (e) {
    if (e instanceof Rejected) {
      await ctx.db
        .update(s.uploads)
        .set({ errorCount: e.errors.length, errors: e.errors.slice(0, STORED_ERRORS) })
        .where(and(eq(s.uploads.id, uploadId), eq(s.uploads.companyId, ctx.companyId)));
      return { uploadId, applied: false, rows, errors: e.errors };
    }
    console.error(`upload ${uploadId} failed to apply`, e);
    throw e;
  }
  return { uploadId, applied: true, rows, errors: [] };
}

class Rejected extends Error {
  constructor(readonly errors: RowError[]) {
    super("upload rejected on re-validation");
  }
}

/** One `applyTargets` per month, earliest first, so two uploads always take the month locks in the same order. */
async function applyTargetOps(ctx: Ctx, tx: Db, ops: TargetOp[], uploadId: string): Promise<void> {
  const months = new Map<string, TargetOp[]>();
  for (const op of ops) {
    const key = `${op.year}-${String(op.month).padStart(2, "0")}`;
    months.set(key, [...(months.get(key) ?? []), op]);
  }
  for (const key of [...months.keys()].sort(byText)) {
    const group = months.get(key)!;
    const result = await applyTargets(
      ctx,
      {
        year: group[0]!.year,
        month: group[0]!.month,
        entries: group.map((o) => ({ userId: o.userId, lineId: o.lineId, amount: o.amount })),
        source: "excel",
        uploadId,
      },
      tx,
    );
    if (!result.ok) throw new Error(`targets apply refused: ${JSON.stringify(result.errors)}`);
  }
}

/**
 * Sets each (rep, date, line) amount from the file. Operations run in (user, date, line) order so the
 * close rows are always locked in the same order. A close that does not exist is created through the
 * (user, date) unique key, so a rep saving that day at the same moment cannot produce a second one.
 */
async function applyDailyOps(ctx: Ctx, tx: Db, ops: DailyOp[], lookup: ImportLookup): Promise<void> {
  const companyId = ctx.companyId;
  const collectionLines = new Set([...lookup.lines.values()].filter((l) => l.kind === "collection").map((l) => l.id));
  const sorted = [...ops].sort((a, b) => byText(a.userId, b.userId) || byText(a.date, b.date) || byText(a.lineId, b.lineId));

  const groups = new Map<string, DailyOp[]>();
  for (const op of sorted) groups.set(`${op.userId}|${op.date}`, [...(groups.get(`${op.userId}|${op.date}`) ?? []), op]);

  for (const group of groups.values()) {
    const { userId, date } = group[0]!;
    const inserted = await tx
      .insert(s.dailyCloses)
      .values({ id: randomUUID(), companyId, userId, date, source: "excel", status: "draft" })
      .onConflictDoNothing({ target: [s.dailyCloses.userId, s.dailyCloses.date] })
      .returning({ id: s.dailyCloses.id });
    let closeId = inserted[0]?.id;
    if (!closeId) {
      const [row] = await tx
        .select({ id: s.dailyCloses.id })
        .from(s.dailyCloses)
        .where(and(eq(s.dailyCloses.companyId, companyId), eq(s.dailyCloses.userId, userId), eq(s.dailyCloses.date, date)))
        .for("update");
      if (!row) throw new Error("close exists for another company or vanished");
      closeId = row.id;
    }

    const existing = await tx
      .select({ id: s.closeLines.id, lineId: s.closeLines.lineId, amount: s.closeLines.amount, source: s.closeLines.source })
      .from(s.closeLines)
      .where(
        and(
          eq(s.closeLines.closeId, closeId),
          eq(s.closeLines.companyId, companyId),
          inArray(s.closeLines.lineId, group.map((o) => o.lineId)),
        ),
      )
      .orderBy(asc(s.closeLines.lineId))
      .for("update");
    const current = new Map(existing.map((r) => [r.lineId, r]));
    for (const op of group) {
      const old = current.get(op.lineId);
      if (!old) {
        await tx
          .insert(s.closeLines)
          .values({ id: randomUUID(), companyId, closeId, lineId: op.lineId, amount: op.amount, source: "excel", repAmount: null });
      } else {
        await tx
          .update(s.closeLines)
          .set({
            amount: op.amount,
            source: "excel",
            // The rep's own value is kept the first time it is replaced; later uploads leave it alone.
            repAmount: old.source === "rep" ? old.amount : sql`${s.closeLines.repAmount}`,
            updatedAt: new Date(),
          })
          .where(and(eq(s.closeLines.id, old.id), eq(s.closeLines.companyId, companyId)));
      }
    }

    // `collections` is the sum of the close's collection lines (the rep form has no separate field for it).
    if (group.some((o) => collectionLines.has(o.lineId))) {
      const [sum] = await tx
        .select({ total: sql<string>`coalesce(sum(${s.closeLines.amount}), 0)`.mapWith(Number) })
        .from(s.closeLines)
        .innerJoin(s.targetLines, eq(s.targetLines.id, s.closeLines.lineId))
        .where(
          and(
            eq(s.closeLines.closeId, closeId),
            eq(s.closeLines.companyId, companyId),
            eq(s.targetLines.companyId, companyId),
            eq(s.targetLines.active, true),
            eq(s.targetLines.kind, "collection"),
          ),
        );
      await tx
        .update(s.dailyCloses)
        .set({ collections: sum?.total ?? 0 })
        .where(and(eq(s.dailyCloses.id, closeId), eq(s.dailyCloses.companyId, companyId)));
    }
  }
}

/** The newest uploads of the caller's company, newest first. */
export async function listUploads(ctx: Ctx, opts: { limit: number }): Promise<UploadRow[]> {
  assertRole(ctx, UPLOAD_ROLES);
  const limit = Math.min(LIST_LIMIT_MAX, Math.max(1, Math.trunc(Number(opts.limit)) || 1));
  const rows = await ctx.db
    .select({
      id: s.uploads.id,
      kind: s.uploads.kind,
      filename: s.uploads.filename,
      rows: s.uploads.rowCount,
      errorCount: s.uploads.errorCount,
      applied: s.uploads.applied,
      createdAt: s.uploads.createdAt,
      byName: s.users.name,
    })
    .from(s.uploads)
    .innerJoin(s.users, and(eq(s.users.id, s.uploads.uploadedBy), eq(s.users.companyId, ctx.companyId)))
    .where(eq(s.uploads.companyId, ctx.companyId))
    .orderBy(desc(s.uploads.createdAt), desc(s.uploads.id))
    .limit(limit);
  return rows;
}
