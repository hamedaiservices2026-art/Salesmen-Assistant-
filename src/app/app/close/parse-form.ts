import type { LineKind } from "@/domain/lines";
import type { Unit } from "@/domain/money";
import { parseAmount } from "@/domain/money";
import type { CloseForm, ReturnReason } from "@/server/repos/closes";

export type ParseResult =
  | { ok: true; form: CloseForm }
  | { ok: false; errors: Record<string, "required" | "invalid"> };

const REASONS: readonly string[] = ["expired", "damaged", "other"];

function text(data: FormData, name: string): string {
  const v = data.get(name);
  return typeof v === "string" ? v.trim() : "";
}

/** Original indexes of the returns rows that hold something (a blank row is dropped). */
export function returnIndexes(data: FormData): number[] {
  const found = new Set<number>();
  for (const key of data.keys()) {
    const m = /^ret\.(\d+)\./.exec(key);
    if (m) found.add(Number(m[1]));
  }
  return [...found]
    .sort((a, b) => a - b)
    .filter((i) => text(data, `ret.${i}.description`) !== "" || text(data, `ret.${i}.quantity`) !== "");
}

/**
 * Reads the day-close form. Field names: `line.<id>`, `focus.<id>`, the money and stock fields by
 * name, and `ret.<i>.description|quantity|reason`. A required field left empty is `required`, one
 * that cannot be read as a number is `invalid`; nothing unreadable is ever turned into 0.
 * When the company has a collection-kind line, `collections` is the sum of those lines (the form
 * has no separate field); otherwise it is read from the `collections` field, optional.
 */
export function parseCloseForm(
  data: FormData,
  lines: { lineId: string; unit: Unit; kind?: LineKind }[],
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
  for (const l of lines) lineAmounts[l.lineId] = read(`line.${l.lineId}`, l.unit, true);
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
    returns.push({ description: text(data, `ret.${i}.description`), quantity, reason: reason as ReturnReason });
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
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
