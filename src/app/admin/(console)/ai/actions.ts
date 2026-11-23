"use server";

import { revalidatePath } from "next/cache";
import { setCompanyAi } from "@/server/ai/consent";
import { requireRole } from "@/server/auth/guard";

/** The company comes from the session; the form carries only the wanted state. */
export async function setCompanyAiAction(form: FormData): Promise<void> {
  const ctx = await requireRole(["admin"]);
  await setCompanyAi(ctx, form.get("enabled") === "1");
  revalidatePath("/admin/ai");
}
