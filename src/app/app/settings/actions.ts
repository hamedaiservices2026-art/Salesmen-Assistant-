"use server";

import { revalidatePath } from "next/cache";
import { requireCtx } from "@/server/auth/guard";
import { setLocale } from "./locale";

export async function setLocaleAction(form: FormData): Promise<void> {
  const ctx = await requireCtx();
  const value = form.get("locale");
  const result = await setLocale(ctx, typeof value === "string" ? value : "");
  if (result.ok) revalidatePath("/", "layout");
}
