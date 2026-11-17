"use server";

import { revalidatePath } from "next/cache";
import { parseAmount } from "@/domain/money";
import { applyTargets, getTargetGrid, targetKey, type TargetEntry } from "@/server/admin/targets";
import { requireRole } from "@/server/auth/guard";
import { parseYm } from "./ym";

export type TargetFormState = {
  /** `userId|lineId` of a cell (or `period`) to an error code. */
  errors?: Record<string, string>;
  /** What the admin typed, by cell key, so a refused save keeps every cell as it was typed. */
  values?: Record<string, string>;
  /** How many targets the last save changed. */
  changed?: number;
};

const CELL = "c:";

// The caller's company and role come from the session (`requireRole`), never from the form; every
// user and line id in the form is checked against that company by `applyTargets`.

export async function saveTargetsAction(_prev: TargetFormState, form: FormData): Promise<TargetFormState> {
  const ctx = await requireRole(["admin"]);
  const ym = parseYm(String(form.get("ym") ?? ""));
  if (!ym) return { errors: { period: "invalid" } };

  // The units come from the company's own grid; an id outside it is parsed as a plain number and
  // then refused by applyTargets (not_found, or coverage_line for a coverage line).
  const grid = await getTargetGrid(ctx, ym);
  const unitOf = new Map(grid.lines.map((l) => [l.lineId, l.unit]));

  const values: Record<string, string> = {};
  const errors: Record<string, string> = {};
  const entries: TargetEntry[] = [];
  for (const [name, raw] of form.entries()) {
    if (!name.startsWith(CELL) || typeof raw !== "string") continue;
    const key = name.slice(CELL.length);
    const sep = key.indexOf("|");
    if (sep <= 0) continue;
    const userId = key.slice(0, sep);
    const lineId = key.slice(sep + 1);
    values[targetKey(userId, lineId)] = raw;
    if (raw.trim() === "") {
      entries.push({ userId, lineId, amount: null });
      continue;
    }
    const amount = parseAmount(raw, unitOf.get(lineId) ?? "cases");
    if (amount === null) errors[targetKey(userId, lineId)] = "invalid";
    else entries.push({ userId, lineId, amount });
  }
  if (Object.keys(errors).length > 0) return { errors, values };

  const result = await applyTargets(ctx, { ...ym, entries, source: "form" });
  if (!result.ok) return { errors: result.errors, values };
  revalidatePath("/admin/targets");
  return { changed: result.changed };
}
