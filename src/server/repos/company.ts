import { eq } from "drizzle-orm";
import type { Locale } from "@/i18n/config";
import { isCurrency, type Currency } from "@/domain/money";
import * as s from "@/db/schema";
import type { Ctx } from "@/server/ctx";

export type CompanyPrefs = {
  currency: Currency;
  behindPct: number;
  timeZone: string;
  defaultLocale: Locale;
  weekStartsOn: number;
};

/** The caller's company preferences; an unrecognised stored currency falls back to SAR. */
export async function getCompanyPrefs(ctx: Ctx): Promise<CompanyPrefs> {
  const [c] = await ctx.db.select().from(s.companies).where(eq(s.companies.id, ctx.companyId));
  if (!c) throw new Error("company not found");
  return {
    currency: isCurrency(c.currency) ? c.currency : "SAR",
    behindPct: c.behindPct,
    timeZone: c.timeZone,
    defaultLocale: c.defaultLocale,
    weekStartsOn: c.weekStartsOn,
  };
}
