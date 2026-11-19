import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { focusName } from "@/domain/focus";
import { formatAmount, inputValue } from "@/domain/money";
import type { Locale } from "@/i18n/config";
import { listAssignableReps, listFocusItems } from "@/server/admin/focus";
import { requireRole } from "@/server/auth/guard";
import { getCompanyPrefs } from "@/server/repos/company";
import { monthBounds } from "@/server/repos/month-data";
import { currentDay } from "@/server/today";
import { Card } from "@/ui/admin/Card";
import { PageHeader } from "@/ui/admin/PageHeader";
import { secondaryButton } from "@/ui/admin/form-styles";
import { INTL_TAG } from "@/ui/intl-tag";
import { unitLabel } from "@/ui/unit-label";
import { formatYm, inRange, parseYm, shiftMonth, type Ym } from "../targets/ym";
import { FocusForm } from "./focus-form";

const navLink =
  "inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-[10px] border border-line bg-white px-3 text-[14px] font-semibold text-brand hover:bg-brand-tint focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";

export default async function FocusPage({ searchParams }: { searchParams: Promise<{ ym?: string; edit?: string }> }) {
  const ctx = await requireRole(["admin"]);
  const [t, tAll, locale, prefs, { ym: ymParam, edit }] = await Promise.all([
    getTranslations("admin.focus"),
    getTranslations(),
    getLocale() as Promise<Locale>,
    getCompanyPrefs(ctx),
    searchParams,
  ]);
  const today = currentDay(prefs.timeZone);
  const current: Ym = { year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) };
  const period = parseYm(ymParam) ?? current;
  const ym = formatYm(period);
  const [items, reps] = await Promise.all([listFocusItems(ctx, period), listAssignableReps(ctx)]);
  const bounds = monthBounds(period.year, period.month);
  const tag = `${INTL_TAG[locale]}-u-nu-latn`;
  const monthName = (p: Ym) =>
    new Intl.DateTimeFormat(tag, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(p.year, p.month - 1, 1)));
  const dateFmt = new Intl.DateTimeFormat(tag, { day: "numeric", month: "short", timeZone: "UTC" });
  const day = (d: string) => dateFmt.format(new Date(`${d}T00:00:00Z`));

  // An id that is not one of this month's items of this company just opens the "new item" form.
  const editing = items.find((i) => i.id === edit);
  const repName = new Map(reps.map((r) => [r.id, r.name]));
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
              <Link href={`/admin/focus?ym=${formatYm(prev)}`} className={navLink} aria-label={t("prevMonth")}>
                <ChevronLeft size={18} strokeWidth={1.8} aria-hidden className={flip} />
              </Link>
            ) : (
              <span className="inline-block min-h-11 min-w-11" aria-hidden />
            )}
            <span className="min-w-36 text-center text-[15px] font-bold text-ink">{monthName(period)}</span>
            {inRange(next) ? (
              <Link href={`/admin/focus?ym=${formatYm(next)}`} className={navLink} aria-label={t("nextMonth")}>
                <ChevronRight size={18} strokeWidth={1.8} aria-hidden className={flip} />
              </Link>
            ) : (
              <span className="inline-block min-h-11 min-w-11" aria-hidden />
            )}
          </nav>
        }
      />
      <Card title={editing ? t("form.editTitle") : t("form.newTitle")}>
        <FocusForm
          key={editing?.id ?? "new"}
          ym={ym}
          reps={reps}
          defaults={{ startsOn: bounds.start, endsOn: bounds.end }}
          item={
            editing
              ? {
                  id: editing.id,
                  name: editing.name,
                  nameEn: editing.nameEn ?? "",
                  nameUr: editing.nameUr ?? "",
                  sku: editing.sku ?? "",
                  unit: editing.unit,
                  target: inputValue(editing.target, editing.unit),
                  startsOn: editing.startsOn,
                  endsOn: editing.endsOn,
                  repIds: editing.repIds,
                  inScheme: editing.inScheme,
                }
              : null
          }
        />
      </Card>
      <Card title={t("listTitle", { month: monthName(period) })} aside={t("listAside", { count: items.length })} className="overflow-hidden">
        {items.length === 0 ? (
          <p className="m-0 px-5 pb-5 text-[14.5px] text-ink-2">{t("empty")}</p>
        ) : (
          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={t("listTitle", { month: monthName(period) })}>
            <table className="w-full border-collapse text-[14.5px]">
              <thead>
                <tr className="bg-canvas">
                  <th scope="col" className={th}>{t("cols.name")}</th>
                  <th scope="col" className={th}>{t("cols.sku")}</th>
                  <th scope="col" className={th}>{t("cols.target")}</th>
                  <th scope="col" className={th}>{t("cols.window")}</th>
                  <th scope="col" className={th}>{t("cols.reps")}</th>
                  <th scope="col" className={th}>
                    <span className="sr-only">{t("cols.actions")}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((i) => (
                  <tr key={i.id} className="border-t border-line-soft align-top">
                    <th scope="row" className="px-4 py-2.5 text-start font-semibold text-ink">
                      <div className="flex flex-col gap-0.5">
                        <bdi>{focusName(i, locale)}</bdi>
                        {([["ar", i.name], ["en", i.nameEn], ["ur", i.nameUr]] as const)
                          .filter(([l, n]) => n && l !== locale && n !== focusName(i, locale))
                          .map(([l, n]) => (
                            <span key={l} lang={l} dir={l === "en" ? "ltr" : "rtl"} className="w-fit text-start text-[13px] font-normal text-ink-2">
                              {n}
                            </span>
                          ))}
                        {i.inScheme && (
                          <span className="mt-1 w-fit rounded-full bg-brand-tint px-2.5 py-0.5 text-[12px] font-semibold text-brand">{t("inScheme")}</span>
                        )}
                      </div>
                    </th>
                    <td className="px-4 py-2.5 text-ink-2" dir="ltr">
                      <span className="block text-start">{i.sku ?? "—"}</span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 tabular-nums">
                      {formatAmount(i.target, i.unit)} <span className="text-[13px] text-ink-2">{unitLabel(tAll, i.unit, prefs.currency)}</span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 tabular-nums text-ink-2">
                      {day(i.startsOn)} – {day(i.endsOn)}
                    </td>
                    <td className="px-4 py-2.5 text-ink-2">
                      {i.repIds.length === 0 ? (
                        t("noneAssigned")
                      ) : (
                        <span className="flex flex-wrap gap-x-2 gap-y-0.5">
                          {i.repIds.map((r, n) => (
                            <span key={r}>
                              <bdi>{repName.get(r) ?? t("inactiveRep")}</bdi>
                              {n < i.repIds.length - 1 ? t("listSeparator") : ""}
                            </span>
                          ))}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex justify-end">
                        <Link href={`/admin/focus?ym=${ym}&edit=${encodeURIComponent(i.id)}`} className={secondaryButton}>
                          {t("edit")}
                        </Link>
                      </div>
                    </td>
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
