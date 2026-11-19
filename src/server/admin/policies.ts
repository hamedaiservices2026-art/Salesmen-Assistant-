import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import * as s from "@/db/schema";
import { POLICY_BODY_MAX, POLICY_TITLE_MAX, codePointLength, splitSections, type PolicySection } from "@/domain/policy";
import { isLocale, type Locale } from "@/i18n/config";
import { assertRole } from "@/server/auth/roles";
import type { Ctx } from "@/server/ctx";

export type PolicyInput = {
  /** The policy to change; omitted to create one. */
  id?: string;
  /** The version the editor read; an edit without it, or with an old one, is `stale`. */
  version?: number;
  title: string;
  locale: Locale;
  body: string;
};

export type PolicyRow = {
  id: string;
  title: string;
  locale: Locale;
  sectionsCount: number;
  version: number;
  updatedAt: Date;
};

export type PolicyDoc = PolicyRow & { body: string; sections: PolicySection[] };

export type SavePolicyResult =
  | { ok: true; id: string; version: number; sections: PolicySection[] }
  | { ok: false; errors: Record<string, string> }
  | { ok: false; error: "not_found" | "stale" };

/** Postgres text cannot hold NUL, and a lone surrogate cannot go into jsonb. */
const clean = (v: unknown): string => (typeof v === "string" ? v.replaceAll("\u0000", "").toWellFormed() : "");

/**
 * Creates a policy or changes one of the caller's company. Field problems come back as
 * `errors[field] = code`: `title` (`required`, `too_long`), `locale` (`invalid`), `body` (`required`,
 * `too_long`: more than 200 000 characters). An id that is not the company's is `not_found`; a save
 * that names an old (or no) version is `stale` and writes nothing. The text is stored as typed, as
 * plain text; the sections are derived from it here.
 */
export async function savePolicy(ctx: Ctx, input: PolicyInput): Promise<SavePolicyResult> {
  assertRole(ctx, ["admin"]);
  const title = clean(input.title).trim();
  const body = clean(input.body);
  const errors: Record<string, string> = {};
  if (title === "") errors.title = "required";
  else if (codePointLength(title) > POLICY_TITLE_MAX) errors.title = "too_long";
  if (!isLocale(input.locale)) errors.locale = "invalid";
  if (body.trim() === "") errors.body = "required";
  else if (codePointLength(body) > POLICY_BODY_MAX) errors.body = "too_long";

  if (input.id !== undefined) {
    // An id outside the company answers the same as a missing one, before anything else is said.
    const [row] = await ctx.db
      .select({ version: s.policyDocuments.version })
      .from(s.policyDocuments)
      .where(and(eq(s.policyDocuments.id, input.id), eq(s.policyDocuments.companyId, ctx.companyId)));
    if (!row) return { ok: false, error: "not_found" };
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const sections = splitSections(body);
  if (input.id === undefined) {
    const id = randomUUID();
    await ctx.db.insert(s.policyDocuments).values({
      id,
      companyId: ctx.companyId,
      title,
      locale: input.locale,
      body,
      sections,
      uploadedBy: ctx.userId,
    });
    return { ok: true, id, version: 0, sections };
  }
  if (!Number.isInteger(input.version)) return { ok: false, error: "stale" };
  const [updated] = await ctx.db
    .update(s.policyDocuments)
    .set({ title, locale: input.locale, body, sections, version: sql`${s.policyDocuments.version} + 1`, updatedAt: new Date() })
    .where(
      and(
        eq(s.policyDocuments.id, input.id),
        eq(s.policyDocuments.companyId, ctx.companyId),
        eq(s.policyDocuments.version, input.version as number),
      ),
    )
    .returning({ version: s.policyDocuments.version });
  if (!updated) return { ok: false, error: "stale" };
  return { ok: true, id: input.id, version: updated.version, sections };
}

/** The company's policies, newest change first; without the text. */
export async function listPolicies(ctx: Ctx): Promise<PolicyRow[]> {
  assertRole(ctx, ["admin"]);
  const rows = await ctx.db
    .select({
      id: s.policyDocuments.id,
      title: s.policyDocuments.title,
      locale: s.policyDocuments.locale,
      sectionsCount: sql<number>`jsonb_array_length(${s.policyDocuments.sections})`.mapWith(Number),
      version: s.policyDocuments.version,
      updatedAt: s.policyDocuments.updatedAt,
    })
    .from(s.policyDocuments)
    .where(eq(s.policyDocuments.companyId, ctx.companyId))
    .orderBy(desc(s.policyDocuments.updatedAt), desc(s.policyDocuments.id));
  return rows;
}

export async function getPolicy(ctx: Ctx, id: string): Promise<{ ok: true; policy: PolicyDoc } | { ok: false; error: "not_found" }> {
  assertRole(ctx, ["admin"]);
  const [row] = await ctx.db
    .select()
    .from(s.policyDocuments)
    .where(and(eq(s.policyDocuments.id, String(id)), eq(s.policyDocuments.companyId, ctx.companyId)));
  if (!row) return { ok: false, error: "not_found" };
  return {
    ok: true,
    policy: {
      id: row.id,
      title: row.title,
      locale: row.locale,
      sectionsCount: row.sections.length,
      version: row.version,
      updatedAt: row.updatedAt,
      body: row.body,
      sections: row.sections,
    },
  };
}

export async function deletePolicy(ctx: Ctx, id: string): Promise<{ ok: true } | { ok: false; error: "not_found" }> {
  assertRole(ctx, ["admin"]);
  const gone = await ctx.db
    .delete(s.policyDocuments)
    .where(and(eq(s.policyDocuments.id, String(id)), eq(s.policyDocuments.companyId, ctx.companyId)))
    .returning({ id: s.policyDocuments.id });
  return gone.length === 0 ? { ok: false, error: "not_found" } : { ok: true };
}
