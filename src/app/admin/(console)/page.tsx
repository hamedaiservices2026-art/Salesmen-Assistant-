import Link from "next/link";
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { Plus, Upload } from "lucide-react";
import { formatAmount } from "@/domain/money";
import type { Locale } from "@/i18n/config";
import { getAskSummary } from "@/server/admin/ask-summary";
import { getOverview } from "@/server/admin/overview";
import { requireRole } from "@/server/auth/guard";
import { getCompanyPrefs } from "@/server/repos/company";
import { currentDay } from "@/server/today";
import { AskCard } from "@/ui/admin/AskCard";
import { Card } from "@/ui/admin/Card";
import { PageHeader } from "@/ui/admin/PageHeader";
import { RepsTable } from "@/ui/admin/RepsTable";
import { TeamIndicators } from "@/ui/admin/TeamIndicators";
import { primaryButton, secondaryButton } from "@/ui/admin/form-styles";
import { INTL_TAG } from "@/ui/intl-tag";
import { unitLabel } from "@/ui/unit-label";

/** The team overview. An owner has none: his only page is the companies list. */
export default async function AdminOverviewPage() {
  const ctx = await requireRole(["admin", "owner"]);
  if (ctx.role === "owner") redirect("/admin/companies");
  const [t, tAll, locale, prefs] = await Promise.all([
    getTranslations("admin.overview"),
    getTranslations(),
    getLocale() as Promise<Locale>,
    getCompanyPrefs(ctx),
  ]);
  const today = currentDay(prefs.timeZone);
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  // The language in use (the cookie) names the lines and incentives, as in the console layout.
  const overview = await getOverview({ ...ctx, locale }, { year, month, today });
  const ask = await getAskSummary(ctx, { now: new Date() });
  const tag = `${INTL_TAG[locale]}-u-nu-latn`;
  const monthName = new Intl.DateTimeFormat(tag, { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(year, month - 1, 1)),
  );
  const stamp = new Intl.DateTimeFormat(tag, { dateStyle: "medium", timeStyle: "short", timeZone: prefs.timeZone });
  const day = new Intl.DateTimeFormat(tag, { day: "numeric", month: "short", timeZone: "UTC" });
  const currency = unitLabel(tAll, "value", prefs.currency);
  const up = overview.lastUpload;

  return (
    <main className="flex flex-col gap-5">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle", { month: monthName, day: overview.dayNumber, total: overview.counts.total, reps: overview.reps.length })}
        actions={
          <>
            <Link href="/admin/uploads" className={secondaryButton}>
              <Upload size={18} strokeWidth={1.9} aria-hidden="true" />
              {t("uploadExcel")}
            </Link>
            <Link href="/admin/incentives" className={primaryButton}>
              <Plus size={18} strokeWidth={2.1} aria-hidden="true" />
              {t("newIncentive")}
            </Link>
          </>
        }
      />
      <TeamIndicators overview={overview} currency={prefs.currency} />
      <div className="flex flex-wrap items-start gap-5">
        <RepsTable overview={overview} today={today} locale={locale} currency={prefs.currency} />
        <div className="flex min-w-0 flex-[0_1_300px] flex-col gap-5">
          <Card title={t("incentives.title")} className="flex flex-col gap-3 pb-4">
            {overview.incentives.length === 0 ? (
              <p className="m-0 px-5 text-[14.5px] text-ink-2">{t("incentives.empty")}</p>
            ) : (
              overview.incentives.map((i) => (
                <div key={i.componentId} className="flex flex-col gap-2.5 px-5">
                  <div className="flex flex-col gap-1">
                    <span className="text-[15px] font-semibold text-ink">
                      <bdi>{i.label}</bdi>
                    </span>
                    <span className="text-[13.5px] text-ink-2 tabular-nums">
                      {t("incentives.until", {
                        amount: formatAmount(i.amount, "value"),
                        currency,
                        date: day.format(new Date(`${i.endsOn}T00:00:00Z`)),
                      })}
                    </span>
                  </div>
                  <dl className="m-0 grid grid-cols-2 gap-2.5">
                    <div className="flex flex-col gap-px">
                      <dt className="text-[13px] text-ink-2">{t("incentives.seen")}</dt>
                      <dd className="m-0 text-base font-bold tabular-nums">{t("incentives.seenOf", { seen: i.seen, notified: i.notified })}</dd>
                    </div>
                    <div className="flex flex-col gap-px">
                      <dt className="text-[13px] text-ink-2">{t("incentives.closest")}</dt>
                      <dd className="m-0 flex flex-col text-base font-bold tabular-nums">
                        {i.closest ? (
                          <>
                            <bdi>{i.closest.name}</bdi>
                            <span className="text-[13.5px] font-medium text-ink-2">
                              {t("incentives.closestValue", {
                                achieved: formatAmount(i.closest.achieved, i.closest.unit),
                                needed: formatAmount(i.closest.needed, i.closest.unit),
                                unit: unitLabel(tAll, i.closest.unit, prefs.currency),
                              })}
                            </span>
                          </>
                        ) : (
                          t("incentives.none")
                        )}
                      </dd>
                    </div>
                  </dl>
                </div>
              ))
            )}
            <p className="m-0 px-5 text-[12.5px] text-muted">{t("incentives.note")}</p>
          </Card>
          <AskCard summary={ask} lead={locale === "ur" ? "leading-[2.2]" : ""} />
          <Card title={t("upload.title")} className="flex flex-col gap-1.5 pb-4">
            {up ? (
              <div className="flex flex-col gap-1.5 px-5">
                <span dir="auto" className="break-all text-[14.5px] font-semibold text-ink">
                  {up.filename}
                </span>
                <span className="text-[13.5px] text-ink-2 tabular-nums">
                  {t("upload.line", { when: stamp.format(up.createdAt), rows: up.rows })} ·{" "}
                  {up.errorCount === 0 ? t("upload.clean") : t("upload.errors", { count: up.errorCount })}
                  {up.applied ? "" : ` · ${t("upload.notApplied")}`}
                </span>
              </div>
            ) : (
              <p className="m-0 px-5 text-[14.5px] text-ink-2">{t("upload.none")}</p>
            )}
          </Card>
        </div>
      </div>
    </main>
  );
}
