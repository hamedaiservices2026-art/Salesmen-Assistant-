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
  const parts = d.parts;
  if (parts && (r.reason === "bonus_not_met" || r.reason === "bonus_met")) {
    return parts
      .map((p) => {
        const pid = p.lineId ?? p.focusItemId;
        const name = pid === undefined ? "" : (names[pid] ?? unnamed());
        return p.pct !== undefined && p.minPct !== undefined
          ? t("reason.part", { name, pct: p.pct, minPct: p.minPct })
          : t("reason.partCount", { name, achieved: fmt(p.achieved, pid), needed: fmt(p.needed ?? 0, pid) });
      })
      .join("، ");
  }
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
      return t(key, { achieved: fmt(d.achieved ?? 0, id), needed: fmt(d.needed ?? 0, id), gap: fmt(d.gap ?? 0, id) });
    }
    case "bonus_expired":
      return t(key, { endsOn: d.endsOn ?? "" });
    case "bonus_not_started":
      return t(key, { startsOn: d.startsOn ?? "" });
    case "blocked_by_gate":
      return t(key, { gate: d.gateId === undefined ? "" : (names[d.gateId] ?? unnamed()) });
    case "no_target":
      return t(key, { line });
  }
}
