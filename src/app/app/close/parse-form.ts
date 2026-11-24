import type { LineKind } from "@/domain/lines";
import type { Unit } from "@/domain/money";
import { parseAmount } from "@/domain/money";
import { isFileId } from "@/domain/files";
import type { CloseForm, ReturnReason } from "@/server/repos/closes";

export type ParseResult =
  /** `draftId`: the hidden receipt id of an AI draft, beside the form (R52); null when absent or not id-shaped. */
  | { ok: true; form: CloseForm; draftId: string | null }
  | { ok: false; errors: Record<string, "required" | "invalid"> };

const REASONS: readonly string[] = ["expired", "damaged", "other"];

function text(data: FormData, name: string): string {
  const v = data.get(name);
  return typeof v === "string" ? v.trim() : "";
}

/** Original indexes of the returns rows that hold something (a blank row is dropped; a row with photos is kept). */
export function returnIndexes(data: FormData): number[] {
  const found = new Set<number>();
  for (const key of data.keys()) {
    const m = /^ret\.(\d+)\./.exec(key);
    if (m) found.add(Number(m[1]));
  }
  return [...found]
    .sort((a, b) => a - b)
    .filter(
      (i) => text(data, `ret.${i}.description`) !== "" || text(data, `ret.${i}.quantity`) !== "" || text(data, `ret.${i}.photos`) !== "",
    );
}

/**
 * Reads the day-close form. Field names: `line.<id>`, `focus.<id>`, the money and stock fields by
 * name, and `ret.<i>.description|quantity|reason|photos` (photos: comma-separated file ids). A required field left empty is `required`, one
 * that cannot be read as a number is `invalid`; nothing unreadable is ever turned into 0.
 * When the company has a collection-kind line, `collections` is the sum of those lines (the form
 * has no separate field; an omitted optional line counts 0); otherwise it is read from the `collections` field, optional.
 */
export function parseCloseForm(
  data: FormData,
  lines: { lineId: string; unit: Unit; kind?: LineKind; optional?: boolean }[],
  focus: { id: string; unit: Unit }[],
): ParseResult {
  const errors: Record<string, "required" | "invalid"> = {};

  const read = (field: string, unit: Unit, required: boolean): number => {
    const raw = text(data, field);
    if (raw === "") {
      if (required) errors[field] = "required";
      return 0;
    }
    const n = parseAmount(raw, unit);
    if (n === null) {
      errors[field] = "invalid";
      return 0;
    }
    return n;
  };

  const lineAmounts: Record<string, number> = {};
  for (const l of lines) {
    // A line that did not exist yet on the close's date may be left empty; it is then not saved.
    if (l.optional && text(data, `line.${l.lineId}`) === "") continue;
    lineAmounts[l.lineId] = read(`line.${l.lineId}`, l.unit, true);
  }
  const focusAmounts: Record<string, number> = {};
  for (const f of focus) focusAmounts[f.id] = read(`focus.${f.id}`, f.unit, false);

  const cashSales = read("cashSales", "value", true);
  const creditSales = read("creditSales", "value", false);
  const collectionLines = lines.filter((l) => l.kind === "collection");
  const collections =
    collectionLines.length > 0
      ? collectionLines.reduce((sum, l) => sum + (lineAmounts[l.lineId] ?? 0), 0)
      : read("collections", "value", false);
  const expenses = read("expenses", "value", false);
  const loaded = read("loaded", "cases", false);
  const sold = read("sold", "cases", false);
  const returned = read("returned", "cases", false);

  const returns: CloseForm["returns"] = [];
  for (const i of returnIndexes(data)) {
    const quantity = read(`ret.${i}.quantity`, "cases", true);
    const reason = text(data, `ret.${i}.reason`);
    if (!REASONS.includes(reason)) errors[`ret.${i}.reason`] = "invalid";
    const row: CloseForm["returns"][number] = { description: text(data, `ret.${i}.description`), quantity, reason: reason as ReturnReason };
    if (data.has(`ret.${i}.photos`)) {
      const raw = text(data, `ret.${i}.photos`);
      const ids = raw === "" ? [] : raw.split(",");
      if (ids.some((id) => !isFileId(id))) errors[`ret.${i}.photos`] = "invalid";
      row.photos = ids;
    }
    returns.push(row);
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const posted = text(data, "draftId");
  return {
    ok: true,
    draftId: isFileId(posted) ? posted : null,
    form: {
      date: text(data, "date"),
      lines: lineAmounts,
      focus: focusAmounts,
      cashSales,
      creditSales,
      collections,
      expenses,
      loaded,
      sold,
      returned,
      returns,
      note: "",
    },
  };
}

/** A line created after the close's date did not exist that day, so the rep may leave it empty. */
export function isOptionalLine(createdOn: string, date: string): boolean {
  return createdOn > date;
}

/**
 * An optional line emptied over a value the REP stored is replaced by 0 (so a collections figure
 * stays the sum of the stored collection lines); a line an admin's upload set keeps its amount and
 * stays out of the form; a line with nothing stored stays out.
 */
export function zeroEmptiedLines<F extends { lines: Record<string, number> }>(
  form: F,
  optionalIds: string[],
  saved: { lines: Record<string, number>; admin: Record<string, unknown> } | null,
): F {
  if (!saved) return form;
  for (const id of optionalIds) {
    if (form.lines[id] !== undefined) continue;
    if (saved.lines[id] !== undefined && saved.admin[id] === undefined) form.lines[id] = 0;
  }
  return form;
}
