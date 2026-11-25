import { desc, eq } from "drizzle-orm";
import * as s from "@/db/schema";
import type { PolicySection } from "@/domain/policy";
import type { Locale } from "@/i18n/config";
import { assertRole } from "@/server/auth/roles";
import type { Ctx } from "@/server/ctx";

export type PolicySections = { docId: string; title: string; locale: Locale; sections: PolicySection[] };

/**
 * The caller's company's policy documents with their sections, for the assistant: documents in the
 * caller's language first, then the others, each group newest change first. Any rep, supervisor or
 * admin of the company may read them; another company's documents are never read.
 */
export async function loadPolicySections(ctx: Ctx): Promise<PolicySections[]> {
  assertRole(ctx, ["rep", "supervisor", "admin"]);
  const rows = await ctx.db
    .select({
      id: s.policyDocuments.id,
      title: s.policyDocuments.title,
      locale: s.policyDocuments.locale,
      sections: s.policyDocuments.sections,
    })
    .from(s.policyDocuments)
    .where(eq(s.policyDocuments.companyId, ctx.companyId))
    .orderBy(desc(s.policyDocuments.updatedAt), desc(s.policyDocuments.id));
  const docs = rows.map((r) => ({ docId: r.id, title: r.title, locale: r.locale, sections: Array.isArray(r.sections) ? r.sections : [] }));
  return [...docs.filter((d) => d.locale === ctx.locale), ...docs.filter((d) => d.locale !== ctx.locale)];
}
