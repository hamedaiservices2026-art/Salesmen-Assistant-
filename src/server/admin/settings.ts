import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import * as s from "@/db/schema";
import type { ISODate } from "@/domain/calendar";
import { isCurrency, type Currency } from "@/domain/money";
import { canonicalTimeZone } from "@/domain/time-zone";
import { isLocale, type Locale } from "@/i18n/config";
import { assertRole } from "@/server/auth/roles";
import type { Ctx } from "@/server/ctx";

export type SettingsInput = {
  name: string;
  currency: Currency;
  timeZone: string;
  /** 0 = Sunday … 6 = Saturday. */
  sellingWeekdays: number[];
  weekStartsOn: number;
  defaultLocale: Locale;
  /** How far under pace, in percent, a rep may be before he counts as "behind" rather than "slightly behind". */
  behindPct: number;
};

export type HolidayRow = { id: string; date: ISODate; name: string | null };

export type CompanySettings = SettingsInput & { holidays: HolidayRow[] };

export type UpdateSettingsResult = { ok: true } | { ok: false; errors: Record<string, string> };
export type AddHolidayResult = { ok: true; id: string } | { ok: false; error: "exists" | "invalid" };
export type RemoveHolidayResult = { ok: true } | { ok: false; error: "not_found" };

const NAME_MAX = 120;
const HOLIDAY_NAME_MAX = 80;

const isWeekday = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 6;

/** A real calendar date written `YYYY-MM-DD`. */
function isRealDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === value;
}

/** The caller's company settings and its holidays, oldest first. */
export async function getCompanySettings(ctx: Ctx): Promise<CompanySettings> {
  assertRole(ctx, ["admin"]);
  const [c] = await ctx.db.select().from(s.companies).where(eq(s.companies.id, ctx.companyId));
  if (!c) throw new Error("company not found");
  const holidays = await ctx.db
    .select({ id: s.holidays.id, date: s.holidays.date, name: s.holidays.name })
    .from(s.holidays)
    .where(eq(s.holidays.companyId, ctx.companyId))
    .orderBy(asc(s.holidays.date));
  return {
    name: c.name,
    currency: isCurrency(c.currency) ? c.currency : "SAR",
    timeZone: c.timeZone,
    sellingWeekdays: [...c.sellingWeekdays],
    weekStartsOn: c.weekStartsOn,
    defaultLocale: c.defaultLocale,
    behindPct: c.behindPct,
    holidays,
  };
}

/** Saves the company settings; every field is validated and nothing is saved when one is refused. */
export async function updateCompanySettings(ctx: Ctx, input: SettingsInput): Promise<UpdateSettingsResult> {
  assertRole(ctx, ["admin"]);
  const errors: Record<string, string> = {};
  const name = String(input.name ?? "").trim();
  if (!name) errors.name = "required";
  else if (name.length > NAME_MAX) errors.name = "invalid";
  if (!isCurrency(input.currency)) errors.currency = "invalid";
  // The stored zone is always accepted as it is (a company created with a zone this list lacks can still save).
  const [stored] = await ctx.db.select({ timeZone: s.companies.timeZone }).from(s.companies).where(eq(s.companies.id, ctx.companyId));
  const typedZone = String(input.timeZone ?? "").trim();
  const timeZone = stored && typedZone === stored.timeZone ? stored.timeZone : canonicalTimeZone(typedZone);
  if (!timeZone) errors.timeZone = "invalid";
  const days = input.sellingWeekdays;
  if (!Array.isArray(days) || days.length === 0 || !days.every(isWeekday) || new Set(days).size !== days.length) {
    errors.sellingWeekdays = "invalid";
  }
  if (!isWeekday(input.weekStartsOn)) errors.weekStartsOn = "invalid";
  if (!isLocale(input.defaultLocale)) errors.defaultLocale = "invalid";
  if (!Number.isInteger(input.behindPct) || input.behindPct < 1 || input.behindPct > 50) errors.behindPct = "invalid";
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  await ctx.db
    .update(s.companies)
    .set({
      name,
      currency: input.currency,
      timeZone: timeZone!,
      sellingWeekdays: [...input.sellingWeekdays].sort((a, b) => a - b),
      weekStartsOn: input.weekStartsOn,
      defaultLocale: input.defaultLocale,
      behindPct: input.behindPct,
      updatedAt: new Date(),
    })
    .where(eq(s.companies.id, ctx.companyId));
  return { ok: true };
}

/** Adds a day off to the company's calendar. The same date twice is `exists` (the unique index decides a race). */
export async function addHoliday(ctx: Ctx, input: { date: ISODate; name?: string }): Promise<AddHolidayResult> {
  assertRole(ctx, ["admin"]);
  const date = String(input.date ?? "");
  const name = String(input.name ?? "").trim();
  if (!isRealDate(date) || name.length > HOLIDAY_NAME_MAX) return { ok: false, error: "invalid" };
  const id = randomUUID();
  const inserted = await ctx.db
    .insert(s.holidays)
    .values({ id, companyId: ctx.companyId, date, name: name || null })
    .onConflictDoNothing()
    .returning({ id: s.holidays.id });
  return inserted.length === 1 ? { ok: true, id } : { ok: false, error: "exists" };
}

/** Removes one of the caller's company holidays; an id of another company is `not_found`. */
export async function removeHoliday(ctx: Ctx, id: string): Promise<RemoveHolidayResult> {
  assertRole(ctx, ["admin"]);
  const removed = await ctx.db
    .delete(s.holidays)
    .where(and(eq(s.holidays.id, String(id)), eq(s.holidays.companyId, ctx.companyId)))
    .returning({ id: s.holidays.id });
  return removed.length === 1 ? { ok: true } : { ok: false, error: "not_found" };
}
