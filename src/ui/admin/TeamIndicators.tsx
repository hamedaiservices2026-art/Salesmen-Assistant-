import { getTranslations } from "next-intl/server";
import type { Currency } from "@/domain/money";
import { formatAmount } from "@/domain/money";
import type { Overview } from "@/server/admin/overview";
import { StatusChip } from "@/ui/components/StatusChip";
import { unitLabel } from "@/ui/unit-label";
import { PaceBar } from "./PaceBar";

const cell = "flex min-w-0 flex-col gap-1.5 border-line-soft px-5 py-[18px]";

/** The indicator band: one cell per sales or collection line, a held cell per coverage line, then reps on pace and closes today. */
export async function TeamIndicators({ overview, currency }: { overview: Overview; currency: Currency }) {
  const [t, tAll] = await Promise.all([getTranslations("admin.overview"), getTranslations()]);
  const lineOf = new Map(overview.lines.map((l) => [l.lineId, l]));
  const total = overview.onPace.total;
  return (
    <section
      aria-label={t("indicators")}
      className="grid grid-cols-1 overflow-hidden rounded-[14px] border border-line bg-white sm:grid-cols-[repeat(auto-fit,minmax(210px,1fr))]"
    >
      {overview.team.map((tl) => {
        const line = lineOf.get(tl.lineId)!;
        const unit = unitLabel(tAll, line.unit, currency);
        const achieved = formatAmount(tl.achieved, line.unit);
        const target = formatAmount(tl.target, line.unit);
        return (
          <div key={tl.lineId} className={`${cell} border-b sm:border-b-0 sm:border-e`}>
            <span className="text-[13.5px] text-ink-2">{line.name}</span>
            <div className="flex flex-wrap items-baseline gap-2.5">
              <span className="text-[32px] font-bold leading-[1.1] tabular-nums" aria-label={t("pctLabel", { pct: tl.pct ?? 0 })}>
                {tl.pct ?? 0}%
              </span>
              {!tl.held && (
                <StatusChip
                  status={tl.status}
                  behindText={t(tl.status === "behind" ? "status.behind" : "status.slightly")}
                  aheadText={t("status.ahead")}
                  noTargetText={t("status.none")}
                />
              )}
            </div>
            <PaceBar
              className="mt-0.5"
              pct={tl.pct}
              expectedPct={tl.expectedPct}
              status={tl.held ? "held" : tl.status}
              label={
                tl.held
                  ? t("barHeld", { achieved, target, unit })
                  : t("bar", { achieved, target, unit, expected: tl.expectedPct ?? 0 })
              }
            />
            <span className="text-[13px] text-ink-2 tabular-nums">
              {tl.held
                ? t("heldFigures", { achieved, target, unit })
                : t("figures", { achieved, target, unit, expected: tl.expectedPct ?? 0 })}
            </span>
          </div>
        );
      })}
      <div className={`${cell} border-b sm:border-b-0 sm:border-e`}>
        <span className="text-[13.5px] text-ink-2">{t("onPace.label")}</span>
        <span className="text-[32px] font-bold leading-[1.1] tabular-nums">
          {overview.onPace.ahead} <span className="text-base font-medium text-ink-2">{t("onPace.of", { total })}</span>
        </span>
        <span className="text-[13px] text-ink-2 tabular-nums">
          {t("onPace.detail", { slightly: overview.onPace.slightly, behind: overview.onPace.behind })}
        </span>
      </div>
      <div className={cell}>
        <span className="text-[13.5px] text-ink-2">{t("closed.label")}</span>
        <span className="text-[32px] font-bold leading-[1.1] tabular-nums">
          {overview.closedToday} <span className="text-base font-medium text-ink-2">{t("closed.of", { total })}</span>
        </span>
        <span className="text-[13px] text-ink-2 tabular-nums">{t("closed.detail", { open: total - overview.closedToday })}</span>
      </div>
    </section>
  );
}
