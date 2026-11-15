import type { ComponentResult } from "@/domain/commission";

type Translator = (key: string, values?: Record<string, string | number>) => string;
type Fmt = (n: number, id?: string) => string | number;

/**
 * One translated sentence per commission result reason. `names` maps line ids and gate ids to the
 * words shown to the rep. `fmt` turns a raw amount into display text (id is the line or focus item
 * it belongs to); by default numbers pass through unchanged.
 */
export function explainResult(
  r: ComponentResult,
  t: Translator,
  names: Record<string, string>,
  fmt: Fmt = (n) => n,
): string {
  const d = r.detail;
  const id = d.lineId ?? d.focusItemId;
  const unnamed = () => t("unnamed");
  const line = d.lineId === undefined ? "" : (names[d.lineId] ?? unnamed());
  const key = `reason.${r.reason}`;
  switch (r.reason) {
    case "tier":
      return t(key, { pct: d.pct ?? 0, tierMinPct: d.tierMinPct ?? 0 });
    case "below_first_tier":
    case "below_threshold":
      return t(key, { pct: d.pct ?? 0, tierMinPct: d.tierMinPct ?? 0 });
    case "rate":
      return t(key, { achieved: fmt(d.achieved ?? 0, id), line });
    case "bonus_met":
      return t(key, { achieved: fmt(d.achieved ?? 0, id), needed: fmt(d.needed ?? 0, id) });
    case "bonus_not_met": {
      const achieved = d.achieved ?? 0;
      const needed = d.needed ?? 0;
      return t(key, { achieved: fmt(achieved, id), needed: fmt(needed, id), gap: fmt(Math.max(0, needed - achieved), id) });
    }
    case "blocked_by_gate":
      return t(key, { gate: d.gateId === undefined ? "" : (names[d.gateId] ?? unnamed()) });
    case "no_target":
      return t(key, { line });
  }
}
