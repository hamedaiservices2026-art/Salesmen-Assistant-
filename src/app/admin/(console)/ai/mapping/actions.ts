"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { saveFieldMap } from "@/server/ai/field-map";
import { requireRole } from "@/server/auth/guard";

export type MappingFormState = {
  /** `errors[fieldKey] = code`, or `form` for a whole-form problem (`stale`). */
  errors?: Record<string, string>;
  /** What the admin typed, so a refused form keeps its values. */
  values?: Record<string, string[]>;
};

const PREFIX = "alias:";
/** More rows than this for one field are not read; the server refuses anything over 8 anyway. */
const READ_PER_FIELD = 40;
const READ_FIELDS = 60;

/** Reads `alias:<key>` entries; the keys are checked against the company's own fields by `saveFieldMap`. */
export async function saveMappingAction(_prev: MappingFormState, form: FormData): Promise<MappingFormState> {
  const ctx = await requireRole(["admin"]);
  const aliases: Record<string, string[]> = Object.create(null) as Record<string, string[]>;
  for (const [name, value] of form.entries()) {
    if (!name.startsWith(PREFIX) || typeof value !== "string") continue;
    const key = name.slice(PREFIX.length).slice(0, 80);
    if (!(key in aliases)) {
      if (Object.keys(aliases).length >= READ_FIELDS) continue;
      aliases[key] = [];
    }
    if (aliases[key]!.length < READ_PER_FIELD) aliases[key]!.push(value);
  }
  const raw = form.get("version");
  const version = typeof raw === "string" && /^\d{1,9}$/.test(raw) ? Number(raw) : -1;
  const plain = { ...aliases };
  const result = await saveFieldMap(ctx, { version, aliases: plain });
  if (!result.ok) return { errors: "errors" in result ? result.errors : { form: result.error }, values: plain };
  revalidatePath("/admin/ai/mapping");
  redirect("/admin/ai/mapping?saved=1");
}
