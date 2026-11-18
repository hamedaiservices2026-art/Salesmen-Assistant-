"use server";

import { revalidatePath } from "next/cache";
import { requireCtx } from "@/server/auth/guard";
import { saveCoverageForm, type CoverageState } from "@/server/repos/coverage-form";
import { currentDay } from "@/server/today";

/** The rep's (or supervisor's) own coverage: the posted rep id is ignored, the session decides. */
export async function saveOwnCoverageAction(_prev: CoverageState, data: FormData): Promise<CoverageState> {
  const ctx = await requireCtx();
  const state = await saveCoverageForm(ctx, data, { today: currentDay(ctx.timeZone), own: true });
  if (state.saved) revalidatePath("/app", "layout");
  return state;
}
