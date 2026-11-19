"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Locale } from "@/i18n/config";
import { deletePolicy, savePolicy } from "@/server/admin/policies";
import { requireRole } from "@/server/auth/guard";

export type PolicyFormState = {
  /** `errors[field] = code`, or `form` for a whole-form problem (`stale`, `not_found`). */
  errors?: Record<string, string>;
  /** What the admin typed, so a refused form keeps its values. */
  values?: Record<string, string>;
};

function text(form: FormData, name: string): string {
  const v = form.get(name);
  return typeof v === "string" ? v : "";
}

// The caller's company and role come from the session; the policy id in the form is checked against
// that company by `savePolicy`.

export async function savePolicyAction(_prev: PolicyFormState, form: FormData): Promise<PolicyFormState> {
  const ctx = await requireRole(["admin"]);
  const values = { id: text(form, "id"), version: text(form, "version"), title: text(form, "title"), locale: text(form, "locale"), body: text(form, "body") };
  const version = /^\d{1,9}$/.test(values.version) ? Number(values.version) : undefined;
  const result = await savePolicy(ctx, {
    id: values.id || undefined,
    version,
    title: values.title,
    locale: values.locale as Locale,
    body: values.body,
  });
  if (!result.ok) return { errors: "errors" in result ? result.errors : { form: result.error }, values };
  revalidatePath("/admin/policies");
  redirect(`/admin/policies?edit=${encodeURIComponent(result.id)}&saved=1`);
}

export async function deletePolicyAction(form: FormData): Promise<void> {
  const ctx = await requireRole(["admin"]);
  // A missing or foreign id changes nothing; the list simply reloads.
  await deletePolicy(ctx, text(form, "id"));
  revalidatePath("/admin/policies");
  redirect("/admin/policies");
}
