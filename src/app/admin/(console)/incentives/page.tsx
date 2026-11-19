import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { focusName } from "@/domain/focus";
import { lineName } from "@/domain/lines";
import { formatAmount } from "@/domain/money";
import type { Locale } from "@/i18n/config";
import { listAllLines } from "@/server/admin/lines";
import { listFocusItems } from "@/server/admin/focus";
import { listIncentives } from "@/server/admin/incentives";
import { getSchemeEditor } from "@/server/admin/schemes";
import { requireRole } from "@/server/auth/guard";
import { getCompanyPrefs } from "@/server/repos/company";
import { currentDay } from "@/server/today";
import { Card } from "@/ui/admin/Card";
import { PageHeader } from "@/ui/admin/PageHeader";
import { secondaryButton } from "@/ui/admin/form-styles";
import { INTL_TAG } from "@/ui/intl-tag";
import { unitLabel } from "@/ui/unit-label";
import { formatYm, inRange, parseYm, shiftMonth, type Ym } from "../targets/ym";
import { IncentiveForm } from "./incentive-form";

const navLink =
  "inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-[10px] border border-line bg-white px-3 text-[14px] font-semibold text-brand hover:bg-brand-tint focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";

export default async function IncentivesPage({ searchParams }: { searchParams: Promise<{ ym?: string }> }) {
  const ctx = await requireRole(["admin"]);
  const [t, tAll, locale, prefs, { ym: ymParam }] = await Promise.all([
    getTranslations("admin.incentives"),
    getTranslations(),
    getLocale() as Promise<Locale>,
    getCompanyPrefs(ctx),
    searchParams,
  ]);
  const today = currentDay(prefs.timeZone);
  const current: Ym = { year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) };
  const period = parseYm(ymParam) ?? current;
  const ym = formatYm(period);
  const [editor, rows, focus, lines] = await Promise.all([
    getSchemeEditor(ctx, period),
    listIncentives(ctx, period),
    listFocusItems(ctx, period),
    listAllLines(ctx),
  ]);
  const published = editor.ok && editor.published !== null;
  const tag = `${INTL_TAG[locale]}-u-nu-latn`;
  const monthName = (p: Ym) =>
    new Intl.DateTimeFormat(tag, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(p.year, p.month - 1, 1)));
  const dateFmt = new Intl.DateTimeFormat(tag, { day: "numeric", month: "short", timeZone: "UTC" });
  const day = (d: string) => dateFmt.format(new Date(`${d}T00:00:00Z`));
  const prev = shiftMonth(period, -1);
  const next = shiftMonth(period, 1);
  const flip = "rtl:-scale-x-100";
  const th = "px-4 py-2.5 text-start text-[13px] font-semibold text-ink-2";

  return (
    <main className="flex flex-col gap-5">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          <nav aria-label={t("monthNav")} className="flex items-center gap-2.5">
            {inRange(prev) ? (
              <Link href={`/admin/incentives?ym=${formatYm(prev)}`} className={navLink} aria-label={t("prevMonth")}>
                <ChevronLeft size={18} strokeWidth={1.8} aria-hidden className={flip} />
              </Link>
            ) : (
              <span className="inline-block min-h-11 min-w-11" aria-hidden />
            )}
            <span className="min-w-36 text-center text-[15px] font-bold text-ink">{monthName(period)}</span>
            {inRange(next) ? (
              <Link href={`/admin/incentives?ym=${formatYm(next)}`} className={navLink} aria-label={t("nextMonth")}>
                <ChevronRight size={18} strokeWidth={1.8} aria-hidden className={flip} />
              </Link>
            ) : (
              <span className="inline-block min-h-11 min-w-11" aria-hidden />
            )}
          </nav>
        }
      />
      <Card title={t("form.title")}>
        {editor.ok && published ? (
          <IncentiveForm
            ym={ym}
            version={editor.version}
            currency={unitLabel(tAll, "value", prefs.currency)}
            focus={focus.map((f) => ({ id: f.id, name: focusName(f, locale), unit: f.unit }))}
            lines={lines.filter((l) => l.active).map((l) => ({ id: l.lineId, name: lineName(l, locale) }))}
          />
        ) : (
          <div className="flex flex-col items-start gap-3 px-5 pb-5">
            <p className="m-0 text-[14.5px] text-ink-2">{t("noScheme")}</p>
            <Link href={`/admin/schemes?ym=${ym}`} className={secondaryButton}>
              {t("openSchemes")}
            </Link>
          </div>
        )}
      </Card>
      <Card title={t("listTitle", { month: monthName(period) })} aside={t("listAside", { count: rows.length })} className="overflow-hidden">
        {rows.length === 0 ? (
          <p className="m-0 px-5 pb-5 text-[14.5px] text-ink-2">{t("empty")}</p>
        ) : (
          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={t("listTitle", { month: monthName(period) })}>
            <table className="w-full border-collapse text-[14.5px]">
              <thead>
                <tr className="bg-canvas">
                  <th scope="col" className={th}>{t("cols.label")}</th>
                  <th scope="col" className={th}>{t("cols.amount")}</th>
                  <th scope="col" className={th}>{t("cols.window")}</th>
                  <th scope="col" className={th}>{t("cols.seen")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.componentId} className="border-t border-line-soft align-top">
                    <th scope="row" className="px-4 py-2.5 text-start font-semibold text-ink">
                      <bdi>{r.label}</bdi>
                    </th>
                    <td className="whitespace-nowrap px-4 py-2.5 tabular-nums">
                      {formatAmount(r.amount, "value")} <span className="text-[13px] text-ink-2">{unitLabel(tAll, "value", prefs.currency)}</span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 tabular-nums text-ink-2">
                      {day(r.startsOn)} – {day(r.endsOn)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 tabular-nums text-ink-2">{t("seen", { seen: r.seen, notified: r.notified })}</td>
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
