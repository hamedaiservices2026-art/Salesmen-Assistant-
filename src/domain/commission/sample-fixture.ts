// Synthetic sample scheme and data shared by the commission tests (see plan "Shared sample data").
import type { Metric, Scheme, SchemeInput } from "./types";

export const sampleScheme: Scheme = {
  id: "nov-2026",
  name: "November 2026",
  components: [
    {
      id: "c_bev",
      type: "tiered",
      label: "شرائح المشروبات",
      lineId: "bev",
      tiers: [
        { minPct: 80, pay: { kind: "fixed", amount: 150_000 } },
        { minPct: 90, pay: { kind: "fixed", amount: 250_000 } },
        { minPct: 100, pay: { kind: "fixed", amount: 400_000 } },
      ],
    },
    {
      id: "c_food",
      type: "per_unit",
      label: "قيمة الأغذية",
      lineId: "food",
      rate: { kind: "pct_of_value", bps: 50 },
    },
    {
      id: "c_coll",
      type: "tiered",
      label: "شريحة التحصيل",
      lineId: "coll",
      tiers: [{ minPct: 90, pay: { kind: "fixed", amount: 100_000 } }],
    },
    {
      id: "c_mango",
      type: "bonus",
      label: "حافز عصير المانجو",
      condition: { kind: "focus_at_least", focusItemId: "mango", min: 200 },
      amount: 50_000,
      startsOn: "2026-11-01",
      endsOn: "2026-11-20",
    },
    {
      id: "g_coll",
      type: "gate",
      label: "شرط التحصيل",
      condition: { kind: "line_pct_at_least", lineId: "coll", minPct: 60 },
      appliesTo: ["c_bev"],
    },
  ],
};

export type SampleInput = SchemeInput & {
  lines: Record<"bev" | "food" | "coll", Metric>;
  focus: Record<"cola" | "mango", { achieved: number }>;
};

export function sampleInput(): SampleInput {
  return {
    lines: {
      bev: { target: 3000, achieved: 1140 },
      food: { target: 18_000_000, achieved: 8_280_000 },
      coll: { target: 45_000_000, achieved: 18_900_000 },
    },
    focus: {
      cola: { achieved: 120 },
      mango: { achieved: 120 },
    },
  };
}
