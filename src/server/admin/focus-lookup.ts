import { and, eq, inArray } from "drizzle-orm";
import * as s from "@/db/schema";
import { assertRole } from "@/server/auth/roles";
import type { Ctx } from "@/server/ctx";

export type FocusInfo = { id: string; name: string; nameEn: string | null; nameUr: string | null; unit: "cases" | "value" };

/** Names and unit of the caller's company's focus items among `ids` (ids of other companies are not returned). */
export async function listFocusInfo(ctx: Ctx, ids: string[]): Promise<FocusInfo[]> {
  assertRole(ctx, ["admin"]);
  if (ids.length === 0) return [];
  return ctx.db
    .select({ id: s.focusItems.id, name: s.focusItems.name, nameEn: s.focusItems.nameEn, nameUr: s.focusItems.nameUr, unit: s.focusItems.unit })
    .from(s.focusItems)
    .where(and(eq(s.focusItems.companyId, ctx.companyId), inArray(s.focusItems.id, ids)));
}
