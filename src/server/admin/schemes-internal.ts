import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import * as s from "@/db/schema";
import type { Component } from "@/domain/commission";
import type { Ctx } from "@/server/ctx";

/**
 * The conditional write of a draft, split out so tests can reach it without the pre-check read in
 * `saveDraft`: it updates only while the row still has the caller's `version` and `draft_rev`, and
 * returns the new `draft_rev`, or null when either moved (another save or publish got there first).
 */
export async function updateDraftRow(
  tx: Db,
  ctx: Ctx,
  schemeId: string,
  components: Component[],
  expectedVersion: number,
  expectedDraftRev: number,
): Promise<{ draftRev: number } | null> {
  const [saved] = await tx
    .update(s.schemes)
    .set({ draft: components, draftRev: sql`${s.schemes.draftRev} + 1`, updatedAt: new Date() })
    .where(
      and(
        eq(s.schemes.id, schemeId),
        eq(s.schemes.companyId, ctx.companyId),
        eq(s.schemes.version, expectedVersion),
        eq(s.schemes.draftRev, expectedDraftRev),
      ),
    )
    .returning({ draftRev: s.schemes.draftRev });
  return saved ?? null;
}
