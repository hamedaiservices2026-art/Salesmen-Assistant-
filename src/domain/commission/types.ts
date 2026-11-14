export type Metric = { target: number; achieved: number };
export type SchemeInput = {
  lines: Record<string, Metric>;
  focus: Record<string, { achieved: number }>; // already limited to each item's date window
};
export type Pay = { kind: "fixed"; amount: number } | { kind: "pct_of_achieved"; bps: number };
export type Condition =
  | { kind: "line_pct_at_least"; lineId: string; minPct: number }
  | { kind: "focus_at_least"; focusItemId: string; min: number };
export type Component =
  | { id: string; type: "tiered"; label: string; lineId: string; tiers: { minPct: number; pay: Pay }[] }
  | {
      id: string;
      type: "per_unit";
      label: string;
      lineId: string;
      rate: { kind: "per_case"; amount: number } | { kind: "pct_of_value"; bps: number };
      abovePct?: number;
    }
  | { id: string; type: "bonus"; label: string; condition: Condition; amount: number; startsOn: string; endsOn: string }
  | { id: string; type: "gate"; label: string; condition: Condition; appliesTo: string[] };
export type Scheme = { id: string; name: string; components: Component[] };
export type ComponentResult = {
  componentId: string;
  label: string;
  amount: number;
  reason:
    | "tier"
    | "below_first_tier"
    | "rate"
    | "below_threshold"
    | "bonus_met"
    | "bonus_not_met"
    | "blocked_by_gate"
    | "no_target";
  detail: {
    lineId?: string;
    focusItemId?: string;
    pct?: number;
    tierMinPct?: number;
    achieved?: number;
    needed?: number;
    gateId?: string;
  };
};
export type Evaluation = { total: number; results: ComponentResult[] }; // gates are not in results
export type NearestWin = {
  componentId: string;
  label: string;
  lineId?: string;
  focusItemId?: string;
  gap: number;
  gain: number;
} | null;
