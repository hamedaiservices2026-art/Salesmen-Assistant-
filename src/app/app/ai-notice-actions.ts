"use server";

import { revalidatePath } from "next/cache";
import { acceptAiNoticeFromForm, withdrawAiNotice } from "@/server/ai/consent";
import { requireCtx } from "@/server/auth/guard";

// Consent is recorded for the signed-in rep only; the form carries just the notice version he saw.

export async function acceptAiNoticeAction(form: FormData): Promise<{ ok: true } | { ok: false; error: "stale_version" }> {
  const ctx = await requireCtx();
  const result = await acceptAiNoticeFromForm(ctx, form);
  if (result.ok) revalidatePath("/app", "layout");
  return result;
}

export async function withdrawAiNoticeAction(): Promise<void> {
  const ctx = await requireCtx();
  await withdrawAiNotice(ctx);
  revalidatePath("/app", "layout");
}
