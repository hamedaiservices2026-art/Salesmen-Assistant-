import { and, eq } from "drizzle-orm";
import { cookies } from "next/headers";
import * as s from "@/db/schema";
import { LOCALE_COOKIE, isLocale } from "@/i18n/config";
import { SESSION_TTL_MS } from "@/server/auth/sessions";
import type { Ctx } from "@/server/ctx";

/** Stores the language on the signed-in user's row. Values outside the supported set are refused. */
export async function saveLocale(ctx: Ctx, locale: string): Promise<{ ok: boolean }> {
  if (!isLocale(locale)) return { ok: false };
  const rows = await ctx.db
    .update(s.users)
    .set({ locale, updatedAt: new Date() })
    .where(and(eq(s.users.id, ctx.userId), eq(s.users.companyId, ctx.companyId)))
    .returning({ id: s.users.id });
  return { ok: rows.length === 1 };
}

/** Saves the language for the user and sets the cookie that the page renderer reads. */
export async function setLocale(ctx: Ctx, locale: string): Promise<{ ok: boolean }> {
  const result = await saveLocale(ctx, locale);
  if (result.ok) {
    (await cookies()).set(LOCALE_COOKIE, locale, {
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: SESSION_TTL_MS / 1000,
    });
  }
  return result;
}
