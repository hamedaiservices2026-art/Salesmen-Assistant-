"use server";

import { revalidatePath } from "next/cache";
import type { Condition, LeafCondition } from "@/domain/commission";
import { parseAmount } from "@/domain/money";
import { listFocusItems } from "@/server/admin/focus";
import { checkIncentiveFields, createIncentive } from "@/server/admin/incentives";
import { requireRole } from "@/server/auth/guard";
import { monthBounds } from "@/server/repos/month-data";
import { parseYm } from "../targets/ym";

export type IncentiveFormState = {
  /** Field name to error code (`admin.incentives.errors`). */
  errors?: Record<string, string>;
  /** Scheme issue codes (`admin.schemes.errors`) for what the month's scheme refuses. */
  issues?: string[];
  /** A page-level refusal: the month changed under the form, or has no published scheme. */
  error?: "stale" | "no_published_scheme" | "period";
  /** What was typed, so a refused form keeps it. */
  values?: Record<string, string>;
  saved?: { notified: number };
};

const text = (form: FormData, name: string): string => {
  const v = form.get(name);
  return typeof v === "string" ? v : "";
};

// The company and role come from the session. The browser sends the month, the typed texts, the
// amount and the condition's pieces; the window is worked out here from the focus item (or the
// month), never taken from the form, and every id is checked against the caller's company.

export async function createIncentiveAction(_prev: IncentiveFormState, form: FormData): Promise<IncentiveFormState> {
  const ctx = await requireRole(["admin"]);
  const fields = [
    "ym", "label", "labelEn", "labelUr", "explanation", "explanationEn", "explanationUr", "amount",
    "mode", "focusItemId", "focusMin", "lineId", "minPct", "expectedVersion",
  ] as const;
  const values = Object.fromEntries(fields.map((f) => [f, text(form, f)])) as Record<(typeof fields)[number], string>;
  const period = parseYm(values.ym);
  if (!period) return { error: "period", values };

  const errors: Record<string, string> = {};
  const amount = parseAmount(values.amount, "value");
  if (amount === null) errors.amount = "invalid";
  const mode = values.mode === "line" || values.mode === "both" ? values.mode : "focus";

  const leaves: LeafCondition[] = [];
  const bounds = monthBounds(period.year, period.month);
  let window = { start: bounds.start, end: bounds.end };
  if (mode === "focus" || mode === "both") {
    const item = (await listFocusItems(ctx, period)).find((i) => i.id === values.focusItemId);
    if (!item) errors.focusItemId = "not_found";
    else {
      const min = parseAmount(values.focusMin, item.unit);
      if (min === null || min < 1) errors.focusMin = "invalid";
      else leaves.push({ kind: "focus_at_least", focusItemId: item.id, min });
      if (mode === "focus") window = { start: item.startsOn, end: item.endsOn };
    }
  }
  if (mode === "line" || mode === "both") {
    const pct = /^\d{1,4}$/.test(values.minPct.trim()) ? Number(values.minPct.trim()) : NaN;
    if (!values.lineId) errors.lineId = "required";
    else if (!Number.isInteger(pct) || pct < 1) errors.minPct = "invalid";
    else leaves.push({ kind: "line_pct_at_least", lineId: values.lineId, minPct: pct });
  }
  const expectedVersion = /^\d{1,9}$/.test(values.expectedVersion) ? Number(values.expectedVersion) : -1;

  const fields2 = {
    label: { ar: values.label, en: values.labelEn, ur: values.labelUr },
    explanation: { ar: values.explanation, en: values.explanationEn, ur: values.explanationUr },
    amount: amount ?? Number.NaN,
    startsOn: window.start,
    endsOn: window.end,
  };
  // Text and amount problems are reported together with the condition's.
  Object.assign(errors, { ...checkIncentiveFields(fields2).errors, ...errors });
  const condition: Condition | undefined = leaves.length === 1 ? leaves[0] : leaves.length > 1 ? { kind: "all", conditions: leaves } : undefined;
  if (Object.keys(errors).length > 0 || !condition) return { errors, values };

  const result = await createIncentive(ctx, { ...period, ...fields2, condition, expectedVersion });
  if (result.ok) {
    revalidatePath("/admin/incentives");
    return { saved: { notified: result.notified } };
  }
  if ("errors" in result) return { errors: result.errors, values };
  if ("issues" in result) return { issues: [...new Set(result.issues.map((i) => i.code))], values };
  return { error: result.error, values };
}
