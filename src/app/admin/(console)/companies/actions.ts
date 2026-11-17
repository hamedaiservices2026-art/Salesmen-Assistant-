"use server";

import { revalidatePath } from "next/cache";
import { createCompany, type NewCompany } from "@/server/admin/companies";
import { requireRole } from "@/server/auth/guard";
import { invitePath } from "@/server/auth/invites";

export type NewCompanyFormState = {
  errors?: Record<string, string>;
  /** What the owner typed, so a refused form keeps its values. */
  values?: Record<string, string>;
  /** Set once after a successful create: the admin's invite link (shown once). */
  created?: { companyName: string; invitePath: string };
};

function text(form: FormData, name: string): string {
  const v = form.get(name);
  return typeof v === "string" ? v : "";
}

/** Owner only: role and company come from the session, never from the form. */
export async function createCompanyAction(_prev: NewCompanyFormState, form: FormData): Promise<NewCompanyFormState> {
  const ctx = await requireRole(["owner"]);
  const values = {
    name: text(form, "name"),
    currency: text(form, "currency"),
    timeZone: text(form, "timeZone"),
    defaultLocale: text(form, "defaultLocale"),
    adminName: text(form, "adminName"),
    adminEmail: text(form, "adminEmail"),
  };
  // createCompany checks every field itself; a currency or language outside the lists comes back as an error.
  const result = await createCompany(ctx, values as NewCompany);
  if (!result.ok) return { errors: result.errors, values };
  revalidatePath("/admin/companies");
  return {
    created: { companyName: values.name.trim(), invitePath: invitePath("admin", result.adminInviteToken) },
  };
}
