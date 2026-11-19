import { checkLeaf, evaluateScheme, mulDivRound, neededForPct, pctOf } from "./evaluate";
import type { Condition, EvalOptions, NearestWin, Scheme, SchemeInput } from "./types";

type Days = { total: number; elapsed: number };

function copyFocus(input: SchemeInput): SchemeInput["focus"] {
  return Object.fromEntries(Object.entries(input.focus).map(([id, f]) => [id, { ...f }]));
}

/**
 * Month-end input at the current pace; with no elapsed days each line is assumed to reach its target.
 * A held metric (a count as of a date, such as coverage) keeps its achieved count.
 */
export function projectInput(input: SchemeInput, days: Days): SchemeInput {
  const lines: SchemeInput["lines"] = {};
  for (const [id, m] of Object.entries(input.lines)) {
    if (m.hold) {
      lines[id] = { ...m };
      continue;
    }
    const achieved = days.elapsed === 0 ? m.target : mulDivRound(m.achieved, days.total, days.elapsed);
    lines[id] = { ...m, achieved };
  }
  return { lines, focus: copyFocus(input) };
}

function focusLeaves(condition: Condition): { focusItemId: string; min: number }[] {
  const leaves = condition.kind === "all" ? condition.conditions : [condition];
  return leaves.flatMap((l) => (l.kind === "focus_at_least" ? [{ focusItemId: l.focusItemId, min: l.min }] : []));
}

/**
 * Input with every line at least at target and every focus item named by a bonus or gate condition
 * (directly or inside an `all`) at least at its minimum. A bonus already expired at `opts.asOf` is skipped.
 */
export function inputAtFullTarget(scheme: Scheme, input: SchemeInput, opts: EvalOptions = {}): SchemeInput {
  const lines: SchemeInput["lines"] = {};
  for (const [id, m] of Object.entries(input.lines)) lines[id] = { ...m, achieved: Math.max(m.achieved, m.target) };
  const focus = copyFocus(input);
  for (const c of scheme.components) {
    if (c.type !== "bonus" && c.type !== "gate") continue;
    if (c.type === "bonus" && opts.asOf !== undefined && opts.asOf > c.endsOn) continue;
    for (const { focusItemId, min } of focusLeaves(c.condition)) {
      focus[focusItemId] = { achieved: Math.max(focus[focusItemId]?.achieved ?? 0, min) };
    }
  }
  return { lines, focus };
}

/** Projection where `lineId` instead grows by `dailyRate` on each day left. */
export function whatIf(
  input: SchemeInput,
  days: Days & { left: number },
  lineId: string,
  dailyRate: number,
): SchemeInput {
  const projected = projectInput(input, days);
  const m = input.lines[lineId];
  if (m) projected.lines[lineId] = { target: m.target, achieved: m.achieved + dailyRate * days.left };
  return projected;
}

type Candidate = { componentId: string; label: string; lineId?: string; focusItemId?: string; needed: number; achieved: number };

function withMetric(input: SchemeInput, c: Candidate): SchemeInput {
  const lines = { ...input.lines };
  const focus = { ...input.focus };
  if (c.lineId !== undefined) lines[c.lineId] = { ...(lines[c.lineId] ?? { target: 0, achieved: 0 }), achieved: c.needed };
  if (c.focusItemId !== undefined) focus[c.focusItemId] = { achieved: c.needed };
  return { lines, focus };
}

/** A condition yields a candidate only when exactly one leaf is unmet and that leaf has a target. */
function conditionCandidate(id: string, label: string, cond: Condition, input: SchemeInput): Candidate | null {
  const leaves = cond.kind === "all" ? cond.conditions : [cond];
  const unmet = leaves.filter((l) => !checkLeaf(l, input).met);
  if (unmet.length !== 1) return null;
  const leaf = unmet[0]!;
  const part = checkLeaf(leaf, input);
  if (part.needed === null) return null;
  const target = leaf.kind === "focus_at_least" ? { focusItemId: leaf.focusItemId } : { lineId: leaf.lineId };
  return { componentId: id, label, ...target, needed: part.needed, achieved: part.achieved };
}

function candidates(scheme: Scheme, input: SchemeInput, opts: EvalOptions): Candidate[] {
  const out: Candidate[] = [];
  for (const c of scheme.components) {
    if (c.type === "tiered") {
      const m = input.lines[c.lineId] ?? { target: 0, achieved: 0 };
      const pct = pctOf(m.achieved, m.target);
      if (pct === null) continue;
      for (const t of c.tiers) {
        if (t.minPct <= pct) continue;
        out.push({ componentId: c.id, label: c.label, lineId: c.lineId, needed: neededForPct(t.minPct, m.target), achieved: m.achieved });
      }
    } else if (c.type === "per_unit") {
      // A per-unit component that pays only above a percent: reaching that percent is a win too.
      if (c.abovePct === undefined) continue;
      const m = input.lines[c.lineId] ?? { target: 0, achieved: 0 };
      const pct = pctOf(m.achieved, m.target);
      if (pct === null || pct >= c.abovePct) continue;
      out.push({ componentId: c.id, label: c.label, lineId: c.lineId, needed: neededForPct(c.abovePct, m.target), achieved: m.achieved });
    } else if (c.type === "bonus" || c.type === "gate") {
      if (c.type === "bonus" && opts.asOf !== undefined && (opts.asOf > c.endsOn || opts.asOf < c.startsOn)) continue;
      const cand = conditionCandidate(c.id, c.label, c.condition, input);
      if (cand) out.push(cand);
    }
  }
  return out;
}

/** The unmet threshold with the smallest relative gap (gap ÷ needed) that would raise the total. */
export function nearestWin(scheme: Scheme, input: SchemeInput, opts: EvalOptions = {}): NearestWin {
  const current = evaluateScheme(scheme, input, opts).total;
  let best: { c: Candidate; gap: number; gain: number } | null = null;
  for (const c of candidates(scheme, input, opts)) {
    const gap = c.needed - c.achieved;
    if (gap <= 0 || c.needed <= 0) continue;
    const gain = evaluateScheme(scheme, withMetric(input, c), opts).total - current;
    if (gain <= 0) continue;
    // gap / needed < best.gap / best.needed, compared exactly by cross-multiplying; ties keep the earlier one.
    if (!best || BigInt(gap) * BigInt(best.c.needed) < BigInt(best.gap) * BigInt(c.needed)) best = { c, gap, gain };
  }
  if (!best) return null;
  const { componentId, label, lineId, focusItemId } = best.c;
  return {
    componentId,
    label,
    ...(lineId === undefined ? {} : { lineId }),
    ...(focusItemId === undefined ? {} : { focusItemId }),
    gap: best.gap,
    gain: best.gain,
  };
}
