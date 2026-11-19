import { getTranslations } from "next-intl/server";
import type { ISODate } from "@/domain/calendar";
import { formatAmount, type Currency } from "@/domain/money";
import { worstStatus } from "@/domain/team";
import type { Overview } from "@/server/admin/overview";
import { StatusChip } from "@/ui/components/StatusChip";
import { unitLabel } from "@/ui/unit-label";
import { INTL_TAG } from "@/ui/intl-tag";
import type { Locale } from "@/i18n/config";
import { PaceBar } from "./PaceBar";
import { Card } from "./Card";

const th = "whitespace-nowrap px-2 py-2.5 text-start text-[13px] font-semibold text-ink-2 first:ps-5 last:pe-5";
const td = "px-2 py-3 first:ps-5 last:pe-5";

/** The day before `date`, as an ISO date (UTC arithmetic: only the calendar date matters). */
function dayBefore(date: ISODate): ISODate {
  return new Date(Date.parse(`${date}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
}

export async function RepsTable({
  overview,
  today,
  locale,
  currency,
}: {
  overview: Overview;
  today: ISODate;
  locale: Locale;
  currency: Currency;
}) {
  const [t, tAll] = await Promise.all([getTranslations("admin.overview"), getTranslations()]);
  const dateFmt = new Intl.DateTimeFormat(`${INTL_TAG[locale]}-u-nu-latn`, { day: "numeric", month: "short", timeZone: "UTC" });
  const shown = overview.lines.filter((l) => overview.team.some((tl) => tl.lineId === l.lineId));
  const yesterday = dayBefore(today);
  return (
    <Card title={t("reps.title")} aside={t("reps.aside")} className="flex-[3_1_760px] overflow-hidden">
      {overview.reps.length === 0 ? (
        <p className="m-0 px-5 pb-5 text-[14.5px] text-ink-2">{t("reps.empty")}</p>
      ) : (
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={t("reps.title")}>
          <table className="w-full min-w-[760px] border-collapse text-[14.5px]">
            <thead>
              <tr className="bg-canvas">
                <th scope="col" className={th}>{t("reps.cols.rep")}</th>
                <th scope="col" className={th}>{t("reps.cols.supervisor")}</th>
                {shown.map((l) => (
                  <th key={l.lineId} scope="col" className={th}>{l.name}</th>
                ))}
                <th scope="col" className={th}>{t("reps.cols.status")}</th>
                <th scope="col" className={th}>{t("reps.cols.lastClose")}</th>
              </tr>
            </thead>
            <tbody>
              {overview.reps.map((r) => {
                const worst = worstStatus(r.lines);
                const late = overview.todaySelling && !r.closedToday;
                return (
                  <tr key={r.repId} className="border-t border-line-soft">
                    <th scope="row" className={`${td} text-start font-semibold text-ink`}>
                      <bdi>{r.name}</bdi>
                      {r.isSupervisor && (
                        <span className="ms-2 rounded bg-canvas px-1.5 py-0.5 align-middle text-[12px] font-medium text-ink-2">{t("reps.supervisorTag")}</span>
                      )}
                    </th>
                    <td className={`${td} text-ink-2`}>{r.supervisorName ? <bdi>{r.supervisorName}</bdi> : t("reps.noSupervisor")}</td>
                    {shown.map((l) => {
                      const rl = r.lines.find((x) => x.lineId === l.lineId);
                      if (!rl || rl.target <= 0) return <td key={l.lineId} className={`${td} text-ink-2`}>{t("barNoTarget")}</td>;
                      const expectedPct = rl.held ? null : Math.floor((rl.expected * 100) / rl.target);
                      const figures = {
                        achieved: formatAmount(rl.achieved, l.unit),
                        target: formatAmount(rl.target, l.unit),
                        unit: unitLabel(tAll, l.unit, currency),
                      };
                      return (
                        <td key={l.lineId} className={td}>
                          <div className="flex items-center gap-2">
                            <PaceBar
                              className="w-[60px] shrink-0"
                              pct={rl.pct}
                              expectedPct={expectedPct}
                              status={rl.held ? "held" : rl.status}
                              label={rl.held ? t("barHeld", figures) : t("bar", { ...figures, expected: expectedPct ?? 0 })}
                            />
                            <span className="font-bold tabular-nums">{rl.pct ?? 0}%</span>
                          </div>
                        </td>
                      );
                    })}
                    <td className={`${td} whitespace-nowrap`}>
                      <StatusChip
                        status={worst}
                        behindText={t(worst === "behind" ? "status.behind" : "status.slightly")}
                        aheadText={t("status.ahead")}
                        noTargetText={t("status.none")}
                      />
                    </td>
                    <td className={`${td} whitespace-nowrap tabular-nums ${late ? "font-semibold text-alert" : "text-ink-2"}`}>
                      {r.lastClose === null
                        ? t("lastClose.never")
                        : r.lastClose === today
                          ? t("lastClose.today")
                          : r.lastClose === yesterday
                            ? t("lastClose.yesterday")
                            : dateFmt.format(new Date(`${r.lastClose}T00:00:00Z`))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
