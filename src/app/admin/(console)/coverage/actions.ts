"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/server/auth/guard";
import { saveCoverageForm, type CoverageState } from "@/server/repos/coverage-form";
import { currentDay } from "@/server/today";

/** An admin updating any rep of his company; the rep id is checked against the session's company. */
export async function saveAdminCoverageAction(_prev: CoverageState, data: FormData): Promise<CoverageState> {
  const ctx = await requireRole(["admin"]);
  const state = await saveCoverageForm(ctx, data, { today: currentDay(ctx.timeZone) });
  if (state.saved) revalidatePath("/admin/coverage");
  return state;
}
