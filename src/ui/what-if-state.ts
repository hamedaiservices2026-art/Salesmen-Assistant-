import { ceilDiv } from "@/domain/pace";
import { evaluateScheme, projectInput, whatIf, type Scheme, type SchemeInput } from "@/domain/commission";
import type { Unit } from "@/domain/money";

type Counts = { total: number; elapsed: number; left: number };

const STEP: Record<Unit, number> = { cases: 5, value: 50_000, outlets: 1 };

export type WhatIfResult = {
  /** Displayed daily rate: the integer per-day figure that reaches the projection, moved by whole steps. */
  rate: number;
  step: number;
  /** The selected line's month-end figure and its target. */
  endAchieved: number;
  target: number;
  total: number;
  canDecrease: boolean;
};

/**
 * What-if at `steps` presses away from the start (0 is the start, + adds one step, - removes one).
 * At 0 the figures are the engine's own projection, untouched; after any press they come from
 * `whatIf` at the displayed rate, so + then - lands back on the start exactly.
 */
export function whatIfAt(
  scheme: Scheme,
  input: SchemeInput,
  counts: Counts,
  line: { lineId: string; unit: Unit },
  steps: number,
): WhatIfResult {
  const step = STEP[line.unit];
  const metric = input.lines[line.lineId] ?? { target: 0, achieved: 0 };
  const base = projectInput(input, counts);
  const baseEnd = base.lines[line.lineId] ?? metric;

  const need = Math.max(0, baseEnd.achieved - metric.achieved);
  const startRate = counts.left > 0 ? ceilDiv(need, counts.left) : 0;
  const minSteps = -ceilDiv(startRate, step);
  const n = Math.max(minSteps, steps);
  const rate = Math.max(0, startRate + n * step);
  const canDecrease = n > minSteps;

  if (n === 0) {
    return {
      rate: startRate,
      step,
      endAchieved: baseEnd.achieved,
      target: baseEnd.target,
      total: evaluateScheme(scheme, base).total,
      canDecrease,
    };
  }
  const projected = whatIf(input, counts, line.lineId, rate);
  const end = projected.lines[line.lineId] ?? metric;
  return {
    rate,
    step,
    endAchieved: end.achieved,
    target: end.target,
    total: evaluateScheme(scheme, projected).total,
    canDecrease,
  };
}
