"use server";

import { revalidatePath } from "next/cache";
import { acceptAiNotice, withdrawAiNotice } from "@/server/ai/consent";
import { requireCtx } from "@/server/auth/guard";

// Consent is recorded for the signed-in rep only; the form carries just the notice version he saw.

export async function acceptAiNoticeAction(form: FormData): Promise<void> {
  const ctx = await requireCtx();
  const raw = form.get("version");
  const version = typeof raw === "string" && /^\d{1,4}$/.test(raw) ? Number(raw) : -1;
  await acceptAiNotice(ctx, version);
  revalidatePath("/app", "layout");
}

export async function withdrawAiNoticeAction(): Promise<void> {
  const ctx = await requireCtx();
  await withdrawAiNotice(ctx);
  revalidatePath("/app", "layout");
}
