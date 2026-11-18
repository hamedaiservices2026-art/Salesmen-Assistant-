"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/server/auth/guard";
import { saveCoverageForm, type CoverageState } from "@/server/repos/coverage-form";
import { currentDay } from "@/server/today";

/** A supervisor updating one of his reps; `addCoverageUpdate` refuses anyone who is not his (`repId: not_found`). */
export async function saveTeamCoverageAction(_prev: CoverageState, data: FormData): Promise<CoverageState> {
  const ctx = await requireRole(["supervisor"]);
  const state = await saveCoverageForm(ctx, data, { today: currentDay(ctx.timeZone) });
  if (state.saved) revalidatePath("/app/team");
  return state;
}
