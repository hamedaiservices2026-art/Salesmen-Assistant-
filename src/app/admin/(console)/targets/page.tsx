import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { lineName } from "@/domain/lines";
import { formatAmount } from "@/domain/money";
import type { Locale } from "@/i18n/config";
import { getTargetGrid, listTargetChanges } from "@/server/admin/targets";
import { requireRole } from "@/server/auth/guard";
import { getCompanyPrefs } from "@/server/repos/company";
import { currentDay } from "@/server/today";
import { Card } from "@/ui/admin/Card";
import { PageHeader } from "@/ui/admin/PageHeader";
import { INTL_TAG } from "@/ui/intl-tag";
import { unitLabel } from "@/ui/unit-label";
import { TargetGrid } from "./target-grid";
import { formatYm, inRange, parseYm, shiftMonth, type Ym } from "./ym";

const LOG_LIMIT = 50;

const navLink =
  "inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-[10px] border border-line bg-white px-3 text-[14px] font-semibold text-brand hover:bg-brand-tint focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";

export default async function TargetsPage({ searchParams }: { searchParams: Promise<{ ym?: string }> }) {
  const ctx = await requireRole(["admin"]);
  const [t, tAll, locale, prefs, { ym: ymParam }] = await Promise.all([
    getTranslations("admin.targets"),
    getTranslations(),
    getLocale() as Promise<Locale>,
    getCompanyPrefs(ctx),
    searchParams,
  ]);
  // No month, or one that is not a real month: the company's current month.
  const today = currentDay(prefs.timeZone);
  const current: Ym = { year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) };
  const period = parseYm(ymParam) ?? current;
  const [grid, changes] = await Promise.all([getTargetGrid(ctx, period), listTargetChanges(ctx, { limit: LOG_LIMIT })]);

  const monthName = (p: Ym) =>
    new Intl.DateTimeFormat(`${INTL_TAG[locale]}-u-nu-latn`, { month: "long", year: "numeric", timeZone: "UTC" }).format(
      new Date(Date.UTC(p.year, p.month - 1, 1)),
    );
  const stamp = new Intl.DateTimeFormat(`${INTL_TAG[locale]}-u-nu-latn`, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: ctx.timeZone,
  });
  const amountText = (amount: number | null, unit: Parameters<typeof formatAmount>[1]) =>
    amount === null ? t("changes.none") : `${formatAmount(amount, unit)}`;

  const columns = grid.lines.map((l) => ({
    lineId: l.lineId,
    name: lineName(l, locale),
    unitText: unitLabel(tAll, l.unit, prefs.currency),
  }));
  const unitOf = new Map(grid.lines.map((l) => [l.lineId, l.unit]));
  const cells = Object.fromEntries(
    // A stored 0 (from before zero meant "no target") shows as an empty cell, never "0".
    Object.entries(grid.amounts).filter(([, amount]) => amount > 0).map(([key, amount]) => {
      const lineId = key.slice(key.indexOf("|") + 1);
      return [key, formatAmount(amount, unitOf.get(lineId) ?? "cases")];
    }),
  );
  const prev = shiftMonth(period, -1);
  const next = shiftMonth(period, 1);
  const flip = "rtl:-scale-x-100";

  return (
    <main className="flex flex-col gap-5">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          <nav aria-label={t("monthNav")} className="flex items-center gap-2.5">
            {inRange(prev) ? (
              <Link href={`/admin/targets?ym=${formatYm(prev)}`} className={navLink} aria-label={t("prevMonth")}>
                <ChevronLeft size={18} strokeWidth={1.8} aria-hidden className={flip} />
              </Link>
            ) : (
              <span className="inline-block min-h-11 min-w-11" aria-hidden />
            )}
            <span className="min-w-36 text-center text-[15px] font-bold text-ink">{monthName(period)}</span>
            {inRange(next) ? (
              <Link href={`/admin/targets?ym=${formatYm(next)}`} className={navLink} aria-label={t("nextMonth")}>
                <ChevronRight size={18} strokeWidth={1.8} aria-hidden className={flip} />
              </Link>
            ) : (
              <span className="inline-block min-h-11 min-w-11" aria-hidden />
            )}
          </nav>
        }
      />
      <Card
        title={t("gridTitle", { month: monthName(period) })}
        aside={t("gridAside", { reps: grid.reps.length, lines: grid.lines.length })}
        className="overflow-hidden"
      >
        {grid.reps.length === 0 || grid.lines.length === 0 ? (
          <p className="m-0 px-5 pb-5 text-[14.5px] text-ink-2">{t("emptyGrid")}</p>
        ) : (
          <TargetGrid ym={formatYm(period)} columns={columns} rows={grid.reps} cells={cells} />
        )}
      </Card>
      <Card title={t("changes.title")} aside={t("changes.aside", { count: LOG_LIMIT })} className="overflow-hidden">
        {changes.length === 0 ? (
          <p className="m-0 px-5 pb-5 text-[14.5px] text-ink-2">{t("changes.empty")}</p>
        ) : (
          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={t("changes.title")}>
            <table className="w-full border-collapse text-[14px]">
              <thead>
                <tr className="border-y border-line text-[13px] text-ink-2">
                  {(["when", "rep", "line", "month", "from", "to", "by", "source"] as const).map((c) => (
                    <th key={c} scope="col" className="whitespace-nowrap px-4 py-2.5 text-start font-semibold">
                      {t(`changes.cols.${c}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {changes.map((c, i) => (
                  <tr key={i} className="border-b border-line last:border-b-0">
                    <td className="whitespace-nowrap px-4 py-2.5 tabular-nums text-ink-2">{stamp.format(c.at)}</td>
                    <td className="px-4 py-2.5 font-semibold text-ink">{c.repName}</td>
                    <td className="px-4 py-2.5 text-ink">{c.lineName}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 tabular-nums text-ink-2" dir="ltr">
                      {formatYm(c)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 tabular-nums text-ink-2">{amountText(c.oldAmount, c.unit)}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 font-semibold tabular-nums text-ink">
                      {c.newAmount === null ? t("changes.removed") : amountText(c.newAmount, c.unit)}
                    </td>
                    <td className="px-4 py-2.5 text-ink-2">{c.byName}</td>
                    <td className="px-4 py-2.5 text-ink-2">{t(`changes.source.${c.source}`)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </main>
  );
}
