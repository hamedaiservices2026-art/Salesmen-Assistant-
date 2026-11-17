import type {
  Component,
  ComponentResult,
  Condition,
  ConditionPart,
  EvalOptions,
  Evaluation,
  LeafCondition,
  Pay,
  Scheme,
  SchemeInput,
} from "./types";

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

/** One leaf condition, with the metric behind it. `needed` is null for a line with no target. */
export function checkLeaf(leaf: LeafCondition, input: SchemeInput): ConditionPart {
  if (leaf.kind === "focus_at_least") {
    const achieved = focusAchieved(input, leaf.focusItemId);
    return { focusItemId: leaf.focusItemId, achieved, needed: leaf.min, met: achieved >= leaf.min };
  }
  const { target, achieved } = line(input, leaf.lineId);
  const pct = pctOf(achieved, target);
  if (pct === null) return { lineId: leaf.lineId, minPct: leaf.minPct, achieved, needed: null, met: false };
  return {
    lineId: leaf.lineId,
    pct,
    minPct: leaf.minPct,
    achieved,
    needed: neededForPct(leaf.minPct, target),
    met: pct >= leaf.minPct,
  };
}

/**
 * Whether a condition holds. A leaf carries its own metric; an `all` condition is met when every
 * leaf is met and lists each leaf in `parts`, in order.
 */
export function checkCondition(
  condition: Condition,
  input: SchemeInput,
): { met: boolean; leaf?: ConditionPart; parts?: ConditionPart[] } {
  if (condition.kind === "all") {
    const parts = condition.conditions.map((c) => checkLeaf(c, input));
    return { met: parts.length > 0 && parts.every((p) => p.met), parts };
  }
  const leaf = checkLeaf(condition, input);
  return { met: leaf.met, leaf };
}

function payAmount(pay: Pay, achieved: number): number {
  return pay.kind === "fixed" ? pay.amount : mulDivRound(achieved, pay.bps, 10000);
}

/** needed and gap = max(0, needed − achieved), for a detail that states what is needed. */
function neededDetail(needed: number, achieved: number): { needed: number; gap: number } {
  return { needed, gap: Math.max(0, needed - achieved) };
}

function conditionDetail(condition: Condition): { lineId?: string; focusItemId?: string } {
  if (condition.kind === "all") return {};
  return condition.kind === "focus_at_least" ? { focusItemId: condition.focusItemId } : { lineId: condition.lineId };
}

function bonusDetail(c: Extract<Component, { type: "bonus" }>, check: ReturnType<typeof checkCondition>): ComponentResult["detail"] {
  if (check.parts) return { parts: check.parts };
  const leaf = check.leaf!;
  return {
    ...conditionDetail(c.condition),
    achieved: leaf.achieved,
    ...(leaf.needed === null ? {} : neededDetail(leaf.needed, leaf.achieved)),
    ...(leaf.pct === undefined ? {} : { pct: leaf.pct }),
  };
}

function evaluateComponent(
  c: Exclude<Component, { type: "gate" }>,
  input: SchemeInput,
  opts: EvalOptions,
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
            ...(first === undefined ? {} : { tierMinPct: first, ...neededDetail(neededForPct(first, target), achieved) }),
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
            detail: {
              lineId: c.lineId,
              pct,
              achieved,
              tierMinPct: c.abovePct,
              ...neededDetail(neededForPct(c.abovePct, target), achieved),
            },
          };
      }
      const amount = c.rate.kind === "per_case" ? achieved * c.rate.amount : mulDivRound(achieved, c.rate.bps, 10000);
      return { amount, reason: "rate", detail: { lineId: c.lineId, achieved, ...pctDetail } };
    }
    case "bonus": {
      const check = checkCondition(c.condition, input);
      const detail = bonusDetail(c, check);
      // A met bonus pays whatever the date; an unmet one outside its window says which side it is on.
      if (check.met) return { amount: c.amount, reason: "bonus_met", detail };
      if (opts.asOf !== undefined && opts.asOf > c.endsOn)
        return { amount: 0, reason: "bonus_expired", detail: { ...detail, endsOn: c.endsOn } };
      if (opts.asOf !== undefined && opts.asOf < c.startsOn)
        return { amount: 0, reason: "bonus_not_started", detail: { ...detail, startsOn: c.startsOn } };
      const noTarget = (check.parts ?? [check.leaf!]).find((p) => p.lineId !== undefined && p.needed === null);
      if (noTarget) return { amount: 0, reason: "no_target", detail: { ...detail, lineId: noTarget.lineId } };
      return { amount: 0, reason: "bonus_not_met", detail };
    }
  }
}

export function evaluateScheme(scheme: Scheme, input: SchemeInput, opts: EvalOptions = {}): Evaluation {
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
    results.push({ componentId: c.id, label: c.label, ...evaluateComponent(c, input, opts) });
  }
  return { total: results.reduce((s, r) => s + r.amount, 0), results };
}
