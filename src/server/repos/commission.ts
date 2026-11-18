import { dayCounts, type ISODate } from "@/domain/calendar";
import {
  evaluateScheme,
  inputAtFullTarget,
  nearestWin,
  projectInput,
  type Evaluation,
  type NearestWin,
  type Scheme,
  type SchemeInput,
} from "@/domain/commission";
import type { LineKind } from "@/domain/lines";
import type { Unit } from "@/domain/money";
import type { Ctx } from "@/server/ctx";
import { loadCalendar, loadMonthTotals, loadScheme, schemeInput } from "./month-data";

export type CommissionView = {
  scheme: Scheme | null;
  input: SchemeInput;
  counts: { total: number; elapsed: number; left: number };
  actual: Evaluation;
  projected: Evaluation;
  atFullTarget: Evaluation;
  nearest: NearestWin;
  lines: { lineId: string; nameAr: string; nameEn: string; nameUr: string; unit: Unit; kind: LineKind }[];
};

const empty = (): Evaluation => ({ total: 0, results: [] });

export async function getCommissionView(
  ctx: Ctx,
  opts: { year: number; month: number; today: ISODate },
): Promise<CommissionView> {
  return commissionViewWith(ctx, opts, loadScheme(ctx, opts.year, opts.month));
}

/**
 * The commission view of the rep in `ctx` for `schemeOf` instead of the month's published scheme.
 * The admin's preview goes through here, so a preview is computed exactly as the rep's screen is.
 */
export async function commissionViewWith(
  ctx: Ctx,
  opts: { year: number; month: number; today: ISODate },
  schemeOf: Scheme | null | Promise<Scheme | null>,
): Promise<CommissionView> {
  const { year, month, today } = opts;
  const [cal, totals, scheme] = await Promise.all([
    loadCalendar(ctx, year, month),
    loadMonthTotals(ctx, year, month),
    schemeOf,
  ]);
  const counts = dayCounts(cal.selling, today);
  const input = schemeInput(totals);
  const lines = totals.lines.map(({ lineId, nameAr, nameEn, nameUr, unit, kind }) => ({ lineId, nameAr, nameEn, nameUr, unit, kind }));

  if (!scheme) {
    return { scheme, input, counts, actual: empty(), projected: empty(), atFullTarget: empty(), nearest: null, lines };
  }
  const asOf = { asOf: today };
  const projectedInput = projectInput(input, counts);
  return {
    scheme,
    input,
    counts,
    actual: evaluateScheme(scheme, input, asOf),
    projected: evaluateScheme(scheme, projectedInput, asOf),
    atFullTarget: evaluateScheme(scheme, inputAtFullTarget(scheme, input, asOf), asOf),
    nearest: nearestWin(scheme, projectedInput, asOf),
    lines,
  };
}
