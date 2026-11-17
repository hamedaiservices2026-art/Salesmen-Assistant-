import { count, eq, ne } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { Db } from "@/db/client";
import * as s from "@/db/schema";
import { isLocale, type Locale } from "@/i18n/config";
import { CURRENCIES, isCurrency, type Currency } from "@/domain/money";
import { createInvite } from "@/server/auth/invites";
import { isEmail, normalizeEmail } from "@/server/auth/password";
import { assertRole } from "@/server/auth/roles";
import type { Ctx } from "@/server/ctx";

export type NewCompany = {
  name: string;
  currency: Currency;
  timeZone: string;
  defaultLocale: Locale;
  adminName: string;
  adminEmail: string;
};

export type CompanyRow = {
  id: string;
  name: string;
  currency: Currency;
  adminCount: number;
  repCount: number;
  createdAt: Date;
};

export type CreateCompanyResult =
  | { ok: true; companyId: string; adminInviteToken: string }
  | { ok: false; errors: Record<string, string> };

/** Selling days and week start of a new company: Saturday to Thursday, the week starting on Saturday. */
const DEFAULT_SELLING_WEEKDAYS = [6, 0, 1, 2, 3, 4];
const WEEK_STARTS_ON = 6;

function validTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return tz.length > 0;
  } catch {
    return false;
  }
}

function isUniqueViolation(e: unknown): boolean {
  const code = (e as { code?: string; cause?: { code?: string } } | null);
  return code?.code === "23505" || code?.cause?.code === "23505";
}

/** The platform owner's list of customer companies (never his own `platform` company), newest last. */
export async function listCompanies(ctx: Ctx): Promise<CompanyRow[]> {
  assertRole(ctx, ["owner"]);
  const companies = await ctx.db
    .select()
    .from(s.companies)
    .where(ne(s.companies.id, ctx.companyId))
    .orderBy(s.companies.createdAt, s.companies.name);
  const counts = await ctx.db
    .select({ companyId: s.users.companyId, role: s.users.role, n: count() })
    .from(s.users)
    .where(eq(s.users.active, true))
    .groupBy(s.users.companyId, s.users.role);
  const n = (companyId: string, role: string) =>
    counts.find((c) => c.companyId === companyId && c.role === role)?.n ?? 0;
  return companies.map((c) => ({
    id: c.id,
    name: c.name,
    currency: isCurrency(c.currency) ? c.currency : CURRENCIES[0],
    adminCount: n(c.id, "admin"),
    repCount: n(c.id, "rep"),
    createdAt: c.createdAt,
  }));
}

/**
 * Creates a company and its first admin in one transaction and returns the admin's invite token
 * (shown once; only its hash is stored). Field problems come back as `errors[field] = code`.
 */
export async function createCompany(ctx: Ctx, input: NewCompany): Promise<CreateCompanyResult> {
  assertRole(ctx, ["owner"]);
  const name = input.name.trim();
  const adminName = input.adminName.trim();
  const email = normalizeEmail(input.adminEmail);
  const errors: Record<string, string> = {};
  if (!name) errors.name = "required";
  if (!isCurrency(input.currency)) errors.currency = "invalid";
  if (!validTimeZone(input.timeZone)) errors.timeZone = "invalid";
  if (!isLocale(input.defaultLocale)) errors.defaultLocale = "invalid";
  if (!adminName) errors.adminName = "required";
  if (!isEmail(email)) errors.adminEmail = "invalid";
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const [existing] = await ctx.db.select({ id: s.users.id }).from(s.users).where(eq(s.users.login, email));
  if (existing) return { ok: false, errors: { adminEmail: "taken" } };

  const companyId = randomUUID();
  const adminId = randomUUID();
  try {
    const adminInviteToken = await ctx.db.transaction(async (tx) => {
      await tx.insert(s.companies).values({
        id: companyId,
        name,
        currency: input.currency,
        timeZone: input.timeZone,
        defaultLocale: input.defaultLocale,
        sellingWeekdays: DEFAULT_SELLING_WEEKDAYS,
        weekStartsOn: WEEK_STARTS_ON,
      });
      await tx
        .insert(s.users)
        .values({ id: adminId, companyId, role: "admin", name: adminName, login: email, locale: input.defaultLocale });
      return createInvite(tx as unknown as Db, adminId);
    });
    return { ok: true, companyId, adminInviteToken };
  } catch (e) {
    // Two owners submitting the same email at once: the unique login index decides.
    if (isUniqueViolation(e)) return { ok: false, errors: { adminEmail: "taken" } };
    throw e;
  }
}
