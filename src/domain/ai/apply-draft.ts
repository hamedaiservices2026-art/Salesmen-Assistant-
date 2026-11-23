// How a close draft meets the day-close form: which inputs it fills and which stay for the rep. Pure.
import { formatAmount, inputValue, maxAmountFor, type Unit } from "@/domain/money";
import { lineKey, MONEY_KEYS, STOCK_KEYS, type CloseDraft, type DraftField, type DraftKey, type DraftLine } from "./draft";

export type FormFill = {
  /** Form field name → text for the input (`inputValue`, ungrouped; R30). */
  values: Record<string, string>;
  /** The fields filled from the draft. */
  marks: Record<string, "ai" | "low">;
  /** Admin-recorded line fields → what the draft read, formatted; never filled (R16). */
  skippedAdmin: Record<string, string>;
  /** Required fields (`cashSales`, every non-optional line without an admin amount) still empty after the fill. */
  missing: string[];
};

export type FormLine = DraftLine & { field: string; optional: boolean; adminAmount?: number };

/** A draft value fit for an input: a safe, non-negative integer within the unit's cap. The draft may come back from sessionStorage, so it is checked again. */
function usable(f: DraftField | undefined, unit: Unit): f is DraftField {
  return (
    f !== undefined &&
    f !== null &&
    typeof f.value === "number" &&
    Number.isSafeInteger(f.value) &&
    f.value >= 0 &&
    f.value <= maxAmountFor(unit)
  );
}

function own(record: Record<string, string>, name: string): string {
  return Object.hasOwn(record, name) && typeof record[name] === "string" ? record[name] : "";
}

/**
 * Fills the form from a draft. A field named in `touched` (the rep typed in it since the page
 * loaded) is left alone; a line with `adminAmount` is never filled; `collections` is filled only
 * when the form has no collection line (R17, R18). A field the draft did not give gets no value,
 * never "0".
 */
export function fillForm(
  draft: CloseDraft,
  form: { lines: FormLine[]; current: Record<string, string>; touched: ReadonlySet<string> },
): FormFill {
  const values: Record<string, string> = {};
  const marks: Record<string, "ai" | "low"> = {};
  const skippedAdmin: Record<string, string> = {};
  const fields: Partial<Record<DraftKey, DraftField>> = typeof draft.fields === "object" && draft.fields !== null ? draft.fields : {};
  const read = (key: DraftKey): DraftField | undefined => (Object.hasOwn(fields, key) ? fields[key] : undefined);

  const fill = (name: string, f: DraftField, unit: Unit) => {
    if (form.touched.has(name)) return;
    values[name] = inputValue(f.value, unit);
    marks[name] = f.low === false ? "ai" : "low";
  };

  const seenCodes = new Set<string>();
  for (const l of form.lines) {
    if (l.kind === "coverage" || l.unit === "outlets" || seenCodes.has(l.code)) continue;
    seenCodes.add(l.code);
    const f = read(lineKey(l.code));
    if (!usable(f, l.unit)) continue;
    if (l.adminAmount !== undefined) {
      skippedAdmin[l.field] = formatAmount(f.value, l.unit);
      continue;
    }
    fill(l.field, f, l.unit);
  }

  const hasCollectionLine = form.lines.some((l) => l.kind === "collection");
  for (const key of MONEY_KEYS) {
    if (key === "collections" && hasCollectionLine) continue;
    const f = read(key);
    if (usable(f, "value")) fill(key, f, "value");
  }
  for (const key of STOCK_KEYS) {
    const f = read(key);
    if (usable(f, "cases")) fill(key, f, "cases");
  }

  const required = [...form.lines.filter((l) => !l.optional && l.adminAmount === undefined && l.kind !== "coverage").map((l) => l.field), "cashSales"];
  const missing = required.filter((name) => (own(values, name) || own(form.current, name)).trim() === "");

  return { values, marks, skippedAdmin, missing };
}
