import { and, eq, inArray } from "drizzle-orm";
import * as s from "@/db/schema";
import type { Ctx } from "@/server/ctx";

/**
 * The only way an admin or supervisor reads one rep's figures: a context for `repId` that the
 * rep loaders can use, or null when the caller may not see him.
 *
 * - admin: any rep or supervisor of his own company (a supervisor can hold targets);
 * - supervisor: himself and the reps whose supervisor he is;
 * - rep: himself only; owner: nobody (his company holds no reps).
 *
 * The result keeps the caller's company, language and time zone, with `userId` of the rep and
 * the role `rep`, so the plan-1 loaders (which filter by company and user) read that rep's rows.
 */
export async function repCtx(ctx: Ctx, repId: string): Promise<Ctx | null> {
  const forRep: Ctx = { ...ctx, userId: repId, role: "rep" };
  switch (ctx.role) {
    case "rep":
      return repId === ctx.userId ? forRep : null;
    case "supervisor": {
      if (repId === ctx.userId) return forRep;
      const [row] = await ctx.db
        .select({ id: s.users.id })
        .from(s.users)
        .where(
          and(
            eq(s.users.id, repId),
            eq(s.users.companyId, ctx.companyId),
            eq(s.users.role, "rep"),
            eq(s.users.supervisorId, ctx.userId),
          ),
        );
      return row ? forRep : null;
    }
    case "admin": {
      const [row] = await ctx.db
        .select({ id: s.users.id })
        .from(s.users)
        .where(
          and(eq(s.users.id, repId), eq(s.users.companyId, ctx.companyId), inArray(s.users.role, ["rep", "supervisor"])),
        );
      return row ? forRep : null;
    }
    default:
      return null;
  }
}
