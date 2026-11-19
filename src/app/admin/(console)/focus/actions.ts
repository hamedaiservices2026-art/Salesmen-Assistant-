"use server";

import { revalidatePath } from "next/cache";
import { parseAmount } from "@/domain/money";
import { saveFocusItem, type FocusInput } from "@/server/admin/focus";
import { requireRole } from "@/server/auth/guard";

export type FocusFormState = {
  errors?: Record<string, string>;
  /** What the admin typed, so a refused form keeps its values. */
  values?: Record<string, string>;
  repIds?: string[];
  saved?: boolean;
};

function text(form: FormData, name: string): string {
  const v = form.get(name);
  return typeof v === "string" ? v : "";
}

// The caller's company and role come from the session (`requireRole`), never from the form; the item
// id and the rep ids in the form are checked against that company by `saveFocusItem`.

export async function saveFocusAction(_prev: FocusFormState, form: FormData): Promise<FocusFormState> {
  const ctx = await requireRole(["admin"]);
  const values = {
    id: text(form, "id"),
    name: text(form, "name"),
    nameEn: text(form, "nameEn"),
    nameUr: text(form, "nameUr"),
    sku: text(form, "sku"),
    unit: text(form, "unit"),
    target: text(form, "target"),
    startsOn: text(form, "startsOn"),
    endsOn: text(form, "endsOn"),
  };
  const repIds = form.getAll("repIds").filter((v): v is string => typeof v === "string");
  const unit = values.unit === "value" ? "value" : "cases";
  // The target is typed in the item's unit: cases are whole numbers, money is in whole riyals (to halalas).
  const parsed = parseAmount(values.target, unit);
  const result = await saveFocusItem(ctx, {
    id: values.id || undefined,
    name: values.name,
    nameEn: values.nameEn,
    nameUr: values.nameUr,
    sku: values.sku,
    unit: values.unit as FocusInput["unit"],
    target: parsed ?? NaN,
    startsOn: values.startsOn as FocusInput["startsOn"],
    endsOn: values.endsOn as FocusInput["endsOn"],
    repIds,
  });
  if (!result.ok) return { errors: result.errors, values, repIds };
  revalidatePath("/admin/focus");
  return { saved: true };
}
