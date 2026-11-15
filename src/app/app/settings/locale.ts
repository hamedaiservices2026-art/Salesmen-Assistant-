import { and, eq } from "drizzle-orm";
import * as s from "@/db/schema";
import { LOCALES, isLocale } from "@/i18n/config";
import type { Ctx } from "@/server/ctx";

/** Stores the language on the signed-in user's row. Values outside the supported set are refused. */
export async function saveLocale(
  ctx: Ctx,
  locale: string,
): Promise<{ ok: boolean }> {
  if (!isLocale(locale) || !LOCALES.includes(locale)) return { ok: false };
  const rows = await ctx.db
    .update(s.users)
    .set({ locale, updatedAt: new Date() })
    .where(
      and(eq(s.users.id, ctx.userId), eq(s.users.companyId, ctx.companyId)),
    )
    .returning({ id: s.users.id });
  return { ok: rows.length === 1 };
}
