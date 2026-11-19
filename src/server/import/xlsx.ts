import ExcelJS from "exceljs";
import JSZip from "jszip";
import type { RawRow } from "@/domain/import/rows";
import { normalizeText } from "@/domain/import/text";
import type { Unit } from "@/domain/money";
import { readSafeZip } from "./safe-zip";
import { COLUMNS } from "@/server/admin/upload-request-shared";

export type SheetKind = "targets" | "daily";
export type ReadError = "not_xlsx" | "empty" | "missing_columns" | "duplicate_columns" | "too_large";
export type ReadResult =
  | { ok: true; rows: RawRow[] }
  | { ok: false; error: ReadError; missing?: string[]; duplicates?: string[] };

/**
 * Limits that keep an untrusted upload from exhausting memory. The zip caps (parts, inflated sizes)
 * live in `safe-zip.ts`; these bound the file and what is read from the sheet.
 */
export const LIMITS = {
  fileBytes: 5 * 1024 * 1024,
  /** Data rows collected; one more than the domain accepts, so it can report `too_many_rows`. */
  dataRows: 5001,
  /** Highest row number the sheet may declare, blank rows included. */
  sheetRows: 20_001,
  columns: 20,
} as const;

const ALIASES: Record<string, string[]> = {
  login: ["login", "username", "اسم المستخدم"],
  line: ["line", "الخط"],
  amount: ["amount", "الكمية", "المبلغ"],
  date: ["date", "التاريخ"],
  year: ["year", "السنة"],
  month: ["month", "الشهر"],
};

const ALIAS_TO_CANONICAL = new Map<string, string>(
  Object.entries(ALIASES).flatMap(([canonical, names]) => names.map((n) => [normalizeText(n).toLowerCase(), canonical] as const)),
);

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

const headerText = (v: unknown): string => (typeof v === "string" ? normalizeText(v).toLowerCase() : "");

/**
 * First worksheet, headers on row 1 (aliases, case-insensitive, invisible marks ignored). Ambiguous
 * files are refused: two columns that resolve to the same name (`login` twice, or `login` and
 * `username`) give `duplicate_columns`. At most 20 columns and 5,001 data rows are read.
 *
 * The upload is never handed to a general zip parser: `readSafeZip` validates it, inflates only the
 * whitelisted parts under hard caps, and a clean stored archive rebuilt from those parts is what
 * exceljs loads.
 */
export async function readSheet(data: ArrayBuffer, kind: SheetKind): Promise<ReadResult> {
  if (data.byteLength > LIMITS.fileBytes) return { ok: false, error: "too_large" };
  const safe = readSafeZip(new Uint8Array(data));
  if (!safe.ok) return { ok: false, error: safe.error };
  const workbook = new ExcelJS.Workbook();
  try {
    const clean = new JSZip();
    for (const [name, content] of safe.files) clean.file(name, content, { binary: true });
    const rebuilt = await clean.generateAsync({ type: "nodebuffer", compression: "STORE" });
    await workbook.xlsx.load(rebuilt as unknown as ArrayBuffer);
  } catch {
    return { ok: false, error: "not_xlsx" };
  }
  try {
    const sheet = workbook.worksheets[0];
    if (!sheet || sheet.rowCount === 0) return { ok: false, error: "empty" };
    if (sheet.rowCount > LIMITS.sheetRows) return { ok: false, error: "too_large" };
    const header = sheet.findRow(1);
    const byColumn = new Map<number, string>();
    const seen = new Set<string>();
    const duplicates: string[] = [];
    for (let c = 1; c <= LIMITS.columns; c++) {
      const canonical = ALIAS_TO_CANONICAL.get(headerText(plain(header?.findCell(c)?.value ?? null)));
      if (!canonical) continue;
      if (seen.has(canonical)) {
        if (!duplicates.includes(canonical)) duplicates.push(canonical);
      } else {
        seen.add(canonical);
        byColumn.set(c, canonical);
      }
    }
    if (duplicates.length > 0) return { ok: false, error: "duplicate_columns", duplicates };
    if (seen.size === 0 && sheet.rowCount <= 1) return { ok: false, error: "empty" };
    const missing = COLUMNS[kind].filter((n) => !seen.has(n));
    if (missing.length > 0) return { ok: false, error: "missing_columns", missing };
    const wanted = new Set(COLUMNS[kind]);
    const rows: RawRow[] = [];
    sheet.eachRow({ includeEmpty: false }, (row, r) => {
      if (r < 2 || rows.length >= LIMITS.dataRows) return;
      const cells: Record<string, unknown> = {};
      let any = false;
      for (const [c, name] of byColumn) {
        if (!wanted.has(name)) continue;
        const v = plain(row.findCell(c)?.value ?? null);
        cells[name] = v;
        if (v !== null && !(typeof v === "string" && normalizeText(v) === "")) any = true;
      }
      if (any) rows.push({ row: r, cells });
    });
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
