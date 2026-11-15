"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { LOCALE_COOKIE } from "@/i18n/config";
import { requireCtx } from "@/server/auth/guard";
import { SESSION_TTL_MS } from "@/server/auth/sessions";
import type { Ctx } from "@/server/ctx";
import { saveLocale } from "./locale";

/** Saves the language for the user and sets the cookie that the page renderer reads. */
export async function setLocale(
  ctx: Ctx,
  locale: string,
): Promise<{ ok: boolean }> {
  const result = await saveLocale(ctx, locale);
  if (result.ok) {
    (await cookies()).set(LOCALE_COOKIE, locale, {
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_TTL_MS / 1000,
    });
  }
  return result;
}

export async function setLocaleAction(form: FormData): Promise<void> {
  const ctx = await requireCtx();
  const value = form.get("locale");
  const result = await setLocale(ctx, typeof value === "string" ? value : "");
  if (result.ok) revalidatePath("/", "layout");
}
