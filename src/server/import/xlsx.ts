import ExcelJS from "exceljs";
import type { RawRow } from "@/domain/import/rows";
import type { Unit } from "@/domain/money";

export type SheetKind = "targets" | "daily";
export type ReadError = "not_xlsx" | "empty" | "missing_columns" | "too_large";
export type ReadResult = { ok: true; rows: RawRow[] } | { ok: false; error: ReadError; missing?: string[] };

/** Limits that keep an untrusted upload from exhausting memory. */
export const LIMITS = {
  fileBytes: 5 * 1024 * 1024,
  /** Sum of the uncompressed sizes the zip declares (a zip bomb declares or inflates far beyond this). */
  unzippedBytes: 25 * 1024 * 1024,
  zipEntries: 500,
  /** Data rows collected; one more than the domain accepts, so it can report `too_many_rows`. */
  dataRows: 5001,
  /** Highest row number the sheet may declare, blank rows included. */
  sheetRows: 20_001,
  columns: 20,
} as const;

const COLUMNS: Record<SheetKind, readonly string[]> = {
  targets: ["login", "year", "month", "line", "amount"],
  daily: ["login", "date", "line", "amount"],
};

const ALIASES: Record<string, string[]> = {
  login: ["login", "username", "اسم المستخدم"],
  line: ["line", "الخط"],
  amount: ["amount", "الكمية", "المبلغ"],
  date: ["date", "التاريخ"],
  year: ["year", "السنة"],
  month: ["month", "الشهر"],
};

const ALIAS_TO_CANONICAL = new Map<string, string>(
  Object.entries(ALIASES).flatMap(([canonical, names]) => names.map((n) => [n.toLowerCase(), canonical] as const)),
);

type ZipCheck = "ok" | "not_xlsx" | "too_large";

/**
 * Reads the zip's central directory by hand, before any parser inflates anything: the signature, a
 * consistent end record, the entry count and the declared uncompressed sizes. A directory that does
 * not parse is `not_xlsx`; zip64 is refused (a file under 5 MB never needs it). The parser also checks
 * each entry's real inflated size against the declared one, so a lying directory fails there.
 */
export function checkZip(bytes: Uint8Array): ZipCheck {
  if (bytes.length < 22 || bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 0x03 || bytes[3] !== 0x04) return "not_xlsx";
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return "not_xlsx";
  const entries = view.getUint16(eocd + 10, true);
  const cdSize = view.getUint32(eocd + 12, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  if (entries === 0 || entries === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) return "not_xlsx";
  if (cdOffset + cdSize > eocd) return "not_xlsx";
  if (entries > LIMITS.zipEntries) return "too_large";
  let pos = cdOffset;
  let total = 0;
  for (let n = 0; n < entries; n++) {
    if (pos + 46 > cdOffset + cdSize || view.getUint32(pos, true) !== 0x02014b50) return "not_xlsx";
    const size = view.getUint32(pos + 24, true);
    const next = pos + 46 + view.getUint16(pos + 28, true) + view.getUint16(pos + 30, true) + view.getUint16(pos + 32, true);
    if (size === 0xffffffff || next > cdOffset + cdSize) return "not_xlsx";
    total += size;
    if (total > LIMITS.unzippedBytes) return "too_large";
    pos = next;
  }
  return "ok";
}

/**
 * A cell as plain data: formulas give their cached result (never evaluated), rich text and hyperlinks
 * their text, error cells `{ error }` (so they fail validation as an invalid value), other objects
 * `{ unsupported: true }`.
 */
function plain(value: ExcelJS.CellValue): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object" || value instanceof Date) return value;
  if ("error" in value) return { error: String(value.error) };
  if ("richText" in value) return value.richText.map((p) => String(p.text ?? "")).join("");
  if ("formula" in value || "sharedFormula" in value) {
    const result = (value as { result?: ExcelJS.CellValue }).result;
    return result === undefined ? null : plain(result);
  }
  if ("hyperlink" in value) return plain((value as { text?: ExcelJS.CellValue }).text ?? null);
  return { unsupported: true };
}

const headerText = (v: unknown): string => (typeof v === "string" ? v.trim().toLowerCase() : "");

/**
 * First worksheet, headers on row 1 (aliases, case-insensitive). When two columns map to the same
 * name (`login` twice, or `login` and `username`) the first, leftmost one is used and the rest are
 * ignored. At most 20 columns and 5,001 data rows are read.
 */
export async function readSheet(data: ArrayBuffer, kind: SheetKind): Promise<ReadResult> {
  if (data.byteLength > LIMITS.fileBytes) return { ok: false, error: "too_large" };
  const bytes = new Uint8Array(data);
  const zip = checkZip(bytes);
  if (zip !== "ok") return { ok: false, error: zip };
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer);
  } catch {
    return { ok: false, error: "not_xlsx" };
  }
  try {
    const sheet = workbook.worksheets[0];
    if (!sheet || sheet.rowCount === 0) return { ok: false, error: "empty" };
    if (sheet.rowCount > LIMITS.sheetRows) return { ok: false, error: "too_large" };
    const header = sheet.getRow(1);
    const byColumn = new Map<number, string>();
    const taken = new Set<string>();
    for (let c = 1; c <= LIMITS.columns; c++) {
      const canonical = ALIAS_TO_CANONICAL.get(headerText(plain(header.getCell(c).value)));
      if (canonical && !taken.has(canonical)) {
        taken.add(canonical);
        byColumn.set(c, canonical);
      }
    }
    if (taken.size === 0 && sheet.rowCount <= 1) return { ok: false, error: "empty" };
    const missing = COLUMNS[kind].filter((n) => !taken.has(n));
    if (missing.length > 0) return { ok: false, error: "missing_columns", missing };
    const wanted = new Set(COLUMNS[kind]);
    const rows: RawRow[] = [];
    for (let r = 2; r <= sheet.rowCount && rows.length < LIMITS.dataRows; r++) {
      const row = sheet.getRow(r);
      const cells: Record<string, unknown> = {};
      let any = false;
      for (const [c, name] of byColumn) {
        if (!wanted.has(name)) continue;
        const v = plain(row.getCell(c).value);
        cells[name] = v;
        if (v !== null && !(typeof v === "string" && v.trim() === "")) any = true;
      }
      if (any) rows.push({ row: r, cells });
    }
    return { ok: true, rows };
  } catch {
    return { ok: false, error: "not_xlsx" };
  }
}

const UNIT_LABEL: Record<Unit, string> = { cases: "cases", value: "value", outlets: "outlets" };

/** Sheet 1: the canonical English header row only. Sheet "الخطوط": each line's code, Arabic name and unit. */
export async function buildTemplate(
  kind: SheetKind,
  lines: { code: string; nameAr: string; unit: Unit }[],
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(kind);
  sheet.addRow([...COLUMNS[kind]]);
  sheet.getRow(1).font = { bold: true };
  for (let c = 1; c <= COLUMNS[kind].length; c++) sheet.getColumn(c).width = 18;
  const ref = workbook.addWorksheet("الخطوط");
  ref.views = [{ rightToLeft: true }];
  ref.addRow(["code", "الاسم", "unit"]);
  ref.getRow(1).font = { bold: true };
  for (const l of lines) ref.addRow([l.code, l.nameAr, UNIT_LABEL[l.unit]]);
  ref.getColumn(1).width = 16;
  ref.getColumn(2).width = 28;
  ref.getColumn(3).width = 12;
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
