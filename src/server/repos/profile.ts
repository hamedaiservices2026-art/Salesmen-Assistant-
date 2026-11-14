import { and, eq } from "drizzle-orm";
import * as s from "@/db/schema";
import type { Ctx } from "@/server/ctx";

/** The signed-in user's display name. */
export async function getDisplayName(ctx: Ctx): Promise<string> {
  const [row] = await ctx.db
    .select({ name: s.users.name })
    .from(s.users)
    .where(and(eq(s.users.id, ctx.userId), eq(s.users.companyId, ctx.companyId)));
  return row?.name ?? "";
}
