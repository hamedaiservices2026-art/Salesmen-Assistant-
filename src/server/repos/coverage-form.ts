import type { ISODate } from "@/domain/calendar";
import { parseAmount } from "@/domain/money";
import type { Ctx } from "@/server/ctx";
import { addCoverageUpdate, type CoverageInput } from "./coverage";

/** What a coverage form returns to the page: field errors, and the line that was just saved. */
export type CoverageState = { errors: Record<string, string>; saved?: string };

const text = (data: FormData, name: string): string => {
  const v = data.get(name);
  return typeof v === "string" ? v.trim() : "";
};

/** The form's fields as a `CoverageInput`; a count that is blank or not a whole number is `invalid`, never 0. */
export function parseCoverageForm(
  data: FormData,
): { ok: true; input: CoverageInput } | { ok: false; errors: Record<string, string> } {
  const covered = parseAmount(text(data, "covered"), "outlets");
  const total = parseAmount(text(data, "total"), "outlets");
  const errors: Record<string, string> = {};
  if (covered === null) errors.covered = "invalid";
  if (total === null) errors.total = "invalid";
  if (covered === null || total === null) return { ok: false, errors };
  return {
    ok: true,
    input: { repId: text(data, "repId"), lineId: text(data, "lineId"), covered, total, asOf: text(data, "asOf") },
  };
}

/**
 * The server-action core shared by the rep's, the supervisor's and the admin's coverage forms. With
 * `own` the posted rep id is ignored and the signed-in user's id is used; otherwise `addCoverageUpdate`
 * checks the posted id against the caller's permission.
 */
export async function saveCoverageForm(
  ctx: Ctx,
  data: FormData,
  opts: { today: ISODate; own?: boolean },
): Promise<CoverageState> {
  const parsed = parseCoverageForm(data);
  if (!parsed.ok) return { errors: parsed.errors };
  const input = opts.own ? { ...parsed.input, repId: ctx.userId } : parsed.input;
  const result = await addCoverageUpdate(ctx, input, { today: opts.today });
  return result.ok ? { errors: {}, saved: input.lineId } : { errors: result.errors };
}
