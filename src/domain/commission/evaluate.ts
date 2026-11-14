import type { Component, ComponentResult, Condition, Evaluation, Pay, Scheme, SchemeInput } from "./types";

// Integer helpers. Inputs are non-negative integers; BigInt keeps intermediate products exact.
// (BigInt() rather than literals: the compile target predates ES2020.)
const TWO = BigInt(2);
const HUNDRED = BigInt(100);

/** round(a × b ÷ c), half up, for non-negative integers and c > 0. */
export function mulDivRound(a: number, b: number, c: number): number {
  const n = BigInt(a) * BigInt(b);
  const d = BigInt(c);
  return Number((TWO * n + d) / (TWO * d));
}

/** floor(achieved × 100 ÷ target); null when target ≤ 0. */
export function pctOf(achieved: number, target: number): number | null {
  if (target <= 0) return null;
  return Number((BigInt(achieved) * HUNDRED) / BigInt(target));
}

/** ceil(minPct × target ÷ 100): the smallest achieved whose percent reaches minPct. */
export function neededForPct(minPct: number, target: number): number {
  return Number((BigInt(minPct) * BigInt(target) + BigInt(99)) / HUNDRED);
}

function line(input: SchemeInput, lineId: string) {
  return input.lines[lineId] ?? { target: 0, achieved: 0 };
}

function focusAchieved(input: SchemeInput, focusItemId: string): number {
  return input.focus[focusItemId]?.achieved ?? 0;
}

/** Whether a condition holds, with the metric behind it. */
export function checkCondition(
  condition: Condition,
  input: SchemeInput,
): { met: boolean; achieved: number; needed: number | null; pct?: number } {
  if (condition.kind === "focus_at_least") {
    const achieved = focusAchieved(input, condition.focusItemId);
    return { met: achieved >= condition.min, achieved, needed: condition.min };
  }
  const { target, achieved } = line(input, condition.lineId);
  const pct = pctOf(achieved, target);
  if (pct === null) return { met: false, achieved, needed: null };
  return { met: pct >= condition.minPct, achieved, needed: neededForPct(condition.minPct, target), pct };
}

function payAmount(pay: Pay, achieved: number): number {
  return pay.kind === "fixed" ? pay.amount : mulDivRound(achieved, pay.bps, 10000);
}

function conditionDetail(condition: Condition): { lineId?: string; focusItemId?: string } {
  return condition.kind === "focus_at_least" ? { focusItemId: condition.focusItemId } : { lineId: condition.lineId };
}

function evaluateComponent(
  c: Exclude<Component, { type: "gate" }>,
  input: SchemeInput,
): Omit<ComponentResult, "componentId" | "label"> {
  switch (c.type) {
    case "tiered": {
      const { target, achieved } = line(input, c.lineId);
      const pct = pctOf(achieved, target);
      if (pct === null) return { amount: 0, reason: "no_target", detail: { lineId: c.lineId, achieved } };
      let best: (typeof c.tiers)[number] | undefined;
      for (const t of c.tiers) if (t.minPct <= pct && (!best || t.minPct > best.minPct)) best = t;
      if (!best) {
        const first = c.tiers.length ? Math.min(...c.tiers.map((t) => t.minPct)) : undefined;
        return {
          amount: 0,
          reason: "below_first_tier",
          detail: {
            lineId: c.lineId,
            pct,
            achieved,
            ...(first === undefined ? {} : { tierMinPct: first, needed: neededForPct(first, target) }),
          },
        };
      }
      return {
        amount: payAmount(best.pay, achieved),
        reason: "tier",
        detail: { lineId: c.lineId, pct, tierMinPct: best.minPct, achieved },
      };
    }
    case "per_unit": {
      const { target, achieved } = line(input, c.lineId);
      const pct = pctOf(achieved, target);
      const pctDetail = pct === null ? {} : { pct };
      if (c.abovePct !== undefined) {
        if (pct === null) return { amount: 0, reason: "no_target", detail: { lineId: c.lineId, achieved } };
        if (pct < c.abovePct)
          return {
            amount: 0,
            reason: "below_threshold",
            detail: { lineId: c.lineId, pct, achieved, tierMinPct: c.abovePct, needed: neededForPct(c.abovePct, target) },
          };
      }
      const amount = c.rate.kind === "per_case" ? achieved * c.rate.amount : mulDivRound(achieved, c.rate.bps, 10000);
      return { amount, reason: "rate", detail: { lineId: c.lineId, achieved, ...pctDetail } };
    }
    case "bonus": {
      const check = checkCondition(c.condition, input);
      const detail = {
        ...conditionDetail(c.condition),
        achieved: check.achieved,
        ...(check.needed === null ? {} : { needed: check.needed }),
        ...(check.pct === undefined ? {} : { pct: check.pct }),
      };
      if (c.condition.kind === "line_pct_at_least" && check.needed === null)
        return { amount: 0, reason: "no_target", detail };
      return check.met
        ? { amount: c.amount, reason: "bonus_met", detail }
        : { amount: 0, reason: "bonus_not_met", detail };
    }
  }
}

export function evaluateScheme(scheme: Scheme, input: SchemeInput): Evaluation {
  // Gates first: a component protected by a failing gate is blocked regardless of its own result.
  const blockedBy = new Map<string, string>();
  for (const c of scheme.components) {
    if (c.type !== "gate" || checkCondition(c.condition, input).met) continue;
    for (const id of c.appliesTo) if (!blockedBy.has(id)) blockedBy.set(id, c.id);
  }

  const results: ComponentResult[] = [];
  for (const c of scheme.components) {
    if (c.type === "gate") continue;
    const gateId = blockedBy.get(c.id);
    if (gateId !== undefined) {
      const lineId = c.type === "bonus" ? conditionDetail(c.condition) : { lineId: c.lineId };
      results.push({ componentId: c.id, label: c.label, amount: 0, reason: "blocked_by_gate", detail: { ...lineId, gateId } });
      continue;
    }
    results.push({ componentId: c.id, label: c.label, ...evaluateComponent(c, input) });
  }
  return { total: results.reduce((s, r) => s + r.amount, 0), results };
}
