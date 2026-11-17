"use server";

import { revalidatePath } from "next/cache";
import { addHoliday, removeHoliday, updateCompanySettings, type SettingsInput } from "@/server/admin/settings";
import { requireRole } from "@/server/auth/guard";

export type SettingsFormState = {
  errors?: Record<string, string>;
  saved?: boolean;
};

export type HolidayFormState = {
  error?: "exists" | "invalid" | "not_found";
  /** What the admin typed in the add form, so a refused one keeps its values. */
  values?: { date: string; name: string };
  added?: boolean;
};

function text(form: FormData, name: string): string {
  const v = form.get(name);
  return typeof v === "string" ? v : "";
}

// The caller's company and role come from the session (`requireRole`), never from the form.

export async function updateSettingsAction(_prev: SettingsFormState, form: FormData): Promise<SettingsFormState> {
  const ctx = await requireRole(["admin"]);
  // updateCompanySettings checks every field; a value outside its list comes back as an error.
  const result = await updateCompanySettings(ctx, {
    name: text(form, "name"),
    currency: text(form, "currency") as SettingsInput["currency"],
    timeZone: text(form, "timeZone"),
    sellingWeekdays: form.getAll("weekday").map((v) => (typeof v === "string" && v.trim() !== "" ? Number(v) : NaN)),
    weekStartsOn: text(form, "weekStartsOn") === "" ? NaN : Number(text(form, "weekStartsOn")),
    defaultLocale: text(form, "defaultLocale") as SettingsInput["defaultLocale"],
    behindPct: text(form, "behindPct") === "" ? NaN : Number(text(form, "behindPct")),
  });
  if (!result.ok) return { errors: result.errors };
  revalidatePath("/admin/settings");
  return { saved: true };
}

export async function addHolidayAction(_prev: HolidayFormState, form: FormData): Promise<HolidayFormState> {
  const ctx = await requireRole(["admin"]);
  const values = { date: text(form, "date"), name: text(form, "name") };
  const result = await addHoliday(ctx, values);
  if (!result.ok) return { error: result.error, values };
  revalidatePath("/admin/settings");
  return { added: true };
}

export async function removeHolidayAction(_prev: HolidayFormState, form: FormData): Promise<HolidayFormState> {
  const ctx = await requireRole(["admin"]);
  const result = await removeHoliday(ctx, text(form, "id"));
  if (!result.ok) return { error: result.error };
  revalidatePath("/admin/settings");
  return {};
}
