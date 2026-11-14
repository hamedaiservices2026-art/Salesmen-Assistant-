import { checkCondition, evaluateScheme, mulDivRound, neededForPct, pctOf } from "./evaluate";
import type { Condition, NearestWin, Scheme, SchemeInput } from "./types";

type Days = { total: number; elapsed: number };

function copyFocus(input: SchemeInput): SchemeInput["focus"] {
  return Object.fromEntries(Object.entries(input.focus).map(([id, f]) => [id, { ...f }]));
}

/** Month-end input at the current pace; with no elapsed days each line is assumed to reach its target. */
export function projectInput(input: SchemeInput, days: Days): SchemeInput {
  const lines: SchemeInput["lines"] = {};
  for (const [id, m] of Object.entries(input.lines)) {
    const achieved = days.elapsed === 0 ? m.target : mulDivRound(m.achieved, days.total, days.elapsed);
    lines[id] = { target: m.target, achieved };
  }
  return { lines, focus: copyFocus(input) };
}

/** Input with every line at least at target and every bonus focus item at least at its minimum. */
export function inputAtFullTarget(scheme: Scheme, input: SchemeInput): SchemeInput {
  const lines: SchemeInput["lines"] = {};
  for (const [id, m] of Object.entries(input.lines)) lines[id] = { target: m.target, achieved: Math.max(m.achieved, m.target) };
  const focus = copyFocus(input);
  for (const c of scheme.components) {
    if (c.type !== "bonus" || c.condition.kind !== "focus_at_least") continue;
    const id = c.condition.focusItemId;
    focus[id] = { achieved: Math.max(focus[id]?.achieved ?? 0, c.condition.min) };
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

function conditionCandidate(id: string, label: string, cond: Condition, input: SchemeInput): Candidate | null {
  const check = checkCondition(cond, input);
  if (check.met || check.needed === null) return null;
  const target = cond.kind === "focus_at_least" ? { focusItemId: cond.focusItemId } : { lineId: cond.lineId };
  return { componentId: id, label, ...target, needed: check.needed, achieved: check.achieved };
}

function candidates(scheme: Scheme, input: SchemeInput): Candidate[] {
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
    } else if (c.type === "bonus" || c.type === "gate") {
      const cand = conditionCandidate(c.id, c.label, c.condition, input);
      if (cand) out.push(cand);
    }
  }
  return out;
}

/** The unmet threshold with the smallest relative gap (gap ÷ needed) that would raise the total. */
export function nearestWin(scheme: Scheme, input: SchemeInput): NearestWin {
  const current = evaluateScheme(scheme, input).total;
  let best: { c: Candidate; gap: number; gain: number } | null = null;
  for (const c of candidates(scheme, input)) {
    const gap = c.needed - c.achieved;
    if (gap <= 0 || c.needed <= 0) continue;
    const gain = evaluateScheme(scheme, withMetric(input, c)).total - current;
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
