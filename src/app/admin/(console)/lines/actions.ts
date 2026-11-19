"use server";

import { revalidatePath } from "next/cache";
import { moveLine, saveLine, setLineActive, type LineInput } from "@/server/admin/lines";
import { requireRole } from "@/server/auth/guard";

export type LineFormState = {
  errors?: Record<string, string>;
  /** What the admin typed, so a refused form keeps its values. */
  values?: Record<string, string>;
  saved?: boolean;
};

export type LineRowState = { error?: "not_found" | "in_scheme" };

function text(form: FormData, name: string): string {
  const v = form.get(name);
  return typeof v === "string" ? v : "";
}

// The caller's company and role come from the session (`requireRole`), never from the form; the line
// id in the form is checked against that company by the admin function.

export async function saveLineAction(_prev: LineFormState, form: FormData): Promise<LineFormState> {
  const ctx = await requireRole(["admin"]);
  const values = {
    id: text(form, "id"),
    code: text(form, "code"),
    nameAr: text(form, "nameAr"),
    nameEn: text(form, "nameEn"),
    nameUr: text(form, "nameUr"),
    unit: text(form, "unit"),
    kind: text(form, "kind"),
    sort: text(form, "sort"),
    active: text(form, "active"),
  };
  // saveLine checks every field; a unit, kind or order outside its list comes back as an error.
  const result = await saveLine(ctx, {
    id: values.id || undefined,
    code: values.code,
    nameAr: values.nameAr,
    nameEn: values.nameEn,
    nameUr: values.nameUr,
    unit: values.unit as LineInput["unit"],
    kind: values.kind as LineInput["kind"],
    // The form posts neither: a new line goes last and starts active, an edit leaves both as they are
    // now (a deactivation or a move made since the form opened must not be undone by saving a name).
    sort: values.sort.trim() === "" ? undefined : Number(values.sort),
    active: values.active === "" ? undefined : values.active === "true",
  });
  if (!result.ok) return { errors: result.errors, values };
  revalidatePath("/admin/lines");
  return { saved: true };
}

export async function setLineActiveAction(_prev: LineRowState, form: FormData): Promise<LineRowState> {
  const ctx = await requireRole(["admin"]);
  const result = await setLineActive(ctx, text(form, "id"), text(form, "active") === "true");
  if (!result.ok) return { error: result.error };
  revalidatePath("/admin/lines");
  return {};
}

export async function moveLineAction(_prev: LineRowState, form: FormData): Promise<LineRowState> {
  const ctx = await requireRole(["admin"]);
  const result = await moveLine(ctx, text(form, "id"), text(form, "direction") === "up" ? "up" : "down");
  if (!result.ok) return { error: result.error };
  revalidatePath("/admin/lines");
  return {};
}
