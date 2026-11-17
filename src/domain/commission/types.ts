import type { ISODate } from "../calendar";

/** hold: a count as of a date (coverage); never extrapolated by the projection. */
export type Metric = { target: number; achieved: number; hold?: boolean };
export type SchemeInput = {
  lines: Record<string, Metric>;
  focus: Record<string, { achieved: number }>; // already limited to each item's date window
};
export type Pay = { kind: "fixed"; amount: number } | { kind: "pct_of_achieved"; bps: number };
export type LeafCondition =
  | { kind: "line_pct_at_least"; lineId: string; minPct: number }
  | { kind: "focus_at_least"; focusItemId: string; min: number };
export type Condition = LeafCondition | { kind: "all"; conditions: LeafCondition[] };
/** Optional English and Urdu labels; `label` is the Arabic label and the fallback. */
type Labels = { label: string; labelEn?: string; labelUr?: string };
export type Component =
  | ({ id: string; type: "tiered"; lineId: string; tiers: { minPct: number; pay: Pay }[] } & Labels)
  | ({
      id: string;
      type: "per_unit";
      lineId: string;
      rate: { kind: "per_case"; amount: number } | { kind: "pct_of_value"; bps: number };
      abovePct?: number;
    } & Labels)
  | ({ id: string; type: "bonus"; condition: Condition; amount: number; startsOn: string; endsOn: string } & Labels)
  | ({ id: string; type: "gate"; condition: Condition; appliesTo: string[] } & Labels);
export type Scheme = { id: string; name: string; components: Component[] };
/** One leaf of a condition, as evaluated. */
export type ConditionPart = {
  lineId?: string;
  focusItemId?: string;
  pct?: number;
  minPct?: number;
  achieved: number;
  needed: number | null;
  met: boolean;
};
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
    | "bonus_expired"
    | "bonus_not_started"
    | "blocked_by_gate"
    | "no_target";
  detail: {
    lineId?: string;
    focusItemId?: string;
    pct?: number;
    tierMinPct?: number;
    achieved?: number;
    needed?: number;
    gap?: number; // max(0, needed − achieved), set wherever needed is set
    gateId?: string;
    parts?: ConditionPart[]; // an `all` condition: one entry per leaf, in order
    startsOn?: ISODate; // bonus_not_started
    endsOn?: ISODate; // bonus_expired
  };
};
export type EvalOptions = { asOf?: ISODate };
export type Evaluation = { total: number; results: ComponentResult[] }; // gates are not in results
export type NearestWin = {
  componentId: string;
  label: string;
  lineId?: string;
  focusItemId?: string;
  gap: number;
  gain: number;
} | null;
