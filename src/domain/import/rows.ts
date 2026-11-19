import type { ISODate } from "@/domain/calendar";
import type { LineKind } from "@/domain/lines";
import { AMOUNT_MAX, parseAmount, type Unit } from "@/domain/money";
import { normalizeText, westernDigits } from "./text";

/** One data row of an uploaded sheet; `row` is the spreadsheet row number, keys are canonical column names. */
export type RawRow = { row: number; cells: Record<string, unknown> };

export type RowErrorCode =
  | "missing"
  | "unknown_rep"
  | "unknown_line"
  | "coverage_line"
  | "invalid_amount"
  | "invalid_period"
  | "invalid_date"
  | "future_date"
  | "not_selling_day"
  | "duplicate"
  | "too_many_rows";

export type RowError = { row: number; column?: string; code: RowErrorCode };

export type ImportLookup = {
  /** login (lowercase) to user id */
  reps: Map<string, string>;
  /** line code (lowercase) to the line */
  lines: Map<string, { id: string; unit: Unit; kind: LineKind }>;
};

export const MAX_DATA_ROWS = 5000;
/** Longer text in any cell is never a real value: it is rejected as invalid, not parsed. */
const MAX_CELL_TEXT = 200;
const YEAR_MIN = 2020;
const YEAR_MAX = 2100;

const isBlank = (v: unknown): boolean => v === null || v === undefined || (typeof v === "string" && normalizeText(v) === "");

/**
 * A cell as text, or null when it cannot be read as one (boolean, object, error cell, NaN, too long).
 * Numbers go through `String(n)` so the amount parser sees exactly what Excel stored.
 */
function cellText(v: unknown): string | null {
  if (typeof v === "string") return v.length > MAX_CELL_TEXT ? null : normalizeText(v);
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : null;
  return null;
}

/**
 * A number cell as a whole stored figure, or null. Excel stores 8250.30 as a double that may print as
 * 8250.300000000001, and a formula's cached result carries the same noise: the value is scaled
 * (100 for money, 1 for counts), rounded, and refused only when it is further than 1e-6 from a whole
 * number of stored units (a third decimal, for instance).
 */
function numberCell(v: number, scale: number): number | null {
  if (!Number.isFinite(v)) return null;
  const scaled = v * scale;
  const whole = Math.round(scaled);
  if (Math.abs(scaled - whole) > 1e-6 || whole < 0 || !Number.isSafeInteger(whole)) return null;
  return whole;
}

function amountOf(v: unknown, unit: Unit): number | null {
  let amount: number | null;
  if (typeof v === "number") amount = numberCell(v, unit === "value" ? 100 : 1);
  else {
    const text = cellText(v);
    amount = text === null ? null : parseAmount(text, unit);
  }
  return amount !== null && amount > AMOUNT_MAX ? null : amount;
}

function intOf(v: unknown): number | null {
  if (typeof v === "number") return numberCell(v, 1);
  const text = cellText(v);
  return text === null ? null : parseAmount(text, "cases");
}

function isRealDate(iso: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso;
}

const inWindow = (iso: string): boolean => /^\d{4}-/.test(iso) && Number(iso.slice(0, 4)) >= YEAR_MIN && Number(iso.slice(0, 4)) <= YEAR_MAX;

function dateOf(v: unknown): ISODate | null {
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    const iso = v.toISOString().slice(0, 10);
    return inWindow(iso) ? iso : null;
  }
  if (typeof v !== "string" || v.length > MAX_CELL_TEXT) return null;
  const t = westernDigits(normalizeText(v));
  return isRealDate(t) && inWindow(t) ? t : null;
}

function key(v: unknown): string | null {
  const text = cellText(v);
  return text === null ? null : text.toLowerCase();
}

type Resolved = { userId: string; line: { id: string; unit: Unit } };

type Failure = { column?: string; code: RowErrorCode };
const fail = (column: string | undefined, code: RowErrorCode): Failure => ({ column, code });

function checkWho(cells: Record<string, unknown>, lookup: ImportLookup): Failure | Resolved {
  if (isBlank(cells.login)) return fail("login", "missing");
  const login = key(cells.login);
  const userId = login === null ? undefined : lookup.reps.get(login);
  if (userId === undefined) return fail("login", "unknown_rep");
  if (isBlank(cells.line)) return fail("line", "missing");
  const code = key(cells.line);
  const line = code === null ? undefined : lookup.lines.get(code);
  if (!line) return fail("line", "unknown_line");
  if (line.kind === "coverage") return fail("line", "coverage_line");
  return { userId, line };
}

const isFailure = (x: Failure | Resolved): x is Failure => "code" in x;

function toError(row: number, f: Failure): RowError {
  return f.column === undefined ? { row, code: f.code } : { row, column: f.column, code: f.code };
}

/** The rows `validate*Rows` look at, in order: blank rows dropped. The n-th op of a clean file came from the n-th of these. */
export function dataRows(rows: RawRow[]): RawRow[] {
  return rows.filter((r) => !Object.values(r.cells).every(isBlank));
}

function run<Op extends object>(
  rows: RawRow[],
  check: (cells: Record<string, unknown>, seen: Set<string>) => Failure | { op: Op },
): { ops: Op[]; errors: RowError[] } {
  const data = dataRows(rows);
  if (data.length > MAX_DATA_ROWS) return { ops: [], errors: [{ row: 0, code: "too_many_rows" }] };
  const seen = new Set<string>();
  const ops: Op[] = [];
  const errors: RowError[] = [];
  for (const r of data) {
    const out = check(r.cells, seen);
    if ("op" in out) ops.push(out.op);
    else errors.push(toError(r.row, out));
  }
  return { ops, errors };
}

export type TargetOp = { userId: string; lineId: string; year: number; month: number; amount: number };

/** Columns `login, year, month, line, amount`. The first problem of a row is the one reported. */
export function validateTargetRows(rows: RawRow[], lookup: ImportLookup): { ops: TargetOp[]; errors: RowError[] } {
  return run<TargetOp>(rows, (cells, seen) => {
    const who = checkWho(cells, lookup);
    if (isFailure(who)) return who;
    if (isBlank(cells.year)) return fail("year", "missing");
    if (isBlank(cells.month)) return fail("month", "missing");
    const year = intOf(cells.year);
    if (year === null || year < YEAR_MIN || year > YEAR_MAX) return fail("year", "invalid_period");
    const month = intOf(cells.month);
    if (month === null || month < 1 || month > 12) return fail("month", "invalid_period");
    if (isBlank(cells.amount)) return fail("amount", "missing");
    const amount = amountOf(cells.amount, who.line.unit);
    if (amount === null) return fail("amount", "invalid_amount");
    const k = `${key(cells.login)}|${year}|${month}|${key(cells.line)}`;
    if (seen.has(k)) return fail(undefined, "duplicate");
    seen.add(k);
    return { op: { userId: who.userId, lineId: who.line.id, year, month, amount } };
  });
}

export type DailyOp = { userId: string; lineId: string; date: ISODate; amount: number };

/** Columns `login, date, line, amount`. The first problem of a row is the one reported. */
export function validateDailyRows(
  rows: RawRow[],
  lookup: ImportLookup & { today: ISODate; isSellingDay: (d: ISODate) => boolean },
): { ops: DailyOp[]; errors: RowError[] } {
  return run<DailyOp>(rows, (cells, seen) => {
    const who = checkWho(cells, lookup);
    if (isFailure(who)) return who;
    if (isBlank(cells.date)) return fail("date", "missing");
    const date = dateOf(cells.date);
    if (date === null) return fail("date", "invalid_date");
    if (date > lookup.today) return fail("date", "future_date");
    if (!lookup.isSellingDay(date)) return fail("date", "not_selling_day");
    if (isBlank(cells.amount)) return fail("amount", "missing");
    const amount = amountOf(cells.amount, who.line.unit);
    if (amount === null) return fail("amount", "invalid_amount");
    const k = `${key(cells.login)}|${date}|${key(cells.line)}`;
    if (seen.has(k)) return fail(undefined, "duplicate");
    seen.add(k);
    return { op: { userId: who.userId, lineId: who.line.id, date, amount } };
  });
}
