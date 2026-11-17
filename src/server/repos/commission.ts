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
  lines: { lineId: string; nameAr: string; nameEn: string; unit: Unit }[];
};

const empty = (): Evaluation => ({ total: 0, results: [] });

export async function getCommissionView(
  ctx: Ctx,
  opts: { year: number; month: number; today: ISODate },
): Promise<CommissionView> {
  const { year, month, today } = opts;
  const [cal, totals, scheme] = await Promise.all([
    loadCalendar(ctx, year, month),
    loadMonthTotals(ctx, year, month),
    loadScheme(ctx, year, month),
  ]);
  const counts = dayCounts(cal.selling, today);
  const input = schemeInput(totals);
  const lines = totals.lines.map(({ lineId, nameAr, nameEn, unit }) => ({ lineId, nameAr, nameEn, unit }));

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
