import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { requireCtx } from "@/server/auth/guard";
import { getCompanyPrefs } from "@/server/repos/company";
import { lineName } from "@/domain/lines";
import type { Locale } from "@/i18n/config";
import { unitLabel as labelFor } from "@/ui/unit-label";
import { getHistoryDays, getMonthSellingDays } from "@/server/repos/history";
import { loadLines } from "@/server/repos/month-data";
import { currentDay } from "@/server/today";
import { formatAmount, type Unit } from "@/domain/money";
import { mergeDayRows, parseYm } from "@/ui/history-rows";
import { INTL_TAG } from "@/ui/intl-tag";

export default async function HistoryMonthPage({
  params,
}: {
  params: Promise<{ ym: string }>;
}) {
  const { ym } = await params;
  const ctx = await requireCtx();
  const today = currentDay(ctx.timeZone);
  const parsed = parseYm(ym, today);
  if (!parsed) notFound();
  const { year, month } = parsed;

  const [t, tRoot, locale, closed, selling, lines, prefs] = await Promise.all([
    getTranslations("history"),
    getTranslations(),
    getLocale(),
    getHistoryDays(ctx, year, month),
    getMonthSellingDays(ctx, year, month),
    loadLines(ctx),
    getCompanyPrefs(ctx),
  ]);
  const rows = mergeDayRows(closed, selling, today);
  const loc = locale as keyof typeof INTL_TAG;
  const tag = INTL_TAG[loc] ?? "ar-EG";
  const first = new Date(Date.UTC(year, month - 1, 1));
  const title = new Intl.DateTimeFormat(tag, {
    month: "long",
    year: "numeric",
    numberingSystem: "latn",
    timeZone: "UTC",
  }).format(first);
  const weekday = new Intl.DateTimeFormat(tag, {
    weekday: "long",
    numberingSystem: "latn",
    timeZone: "UTC",
  });
  const label = (u: Unit) =>
    labelFor((k) => tRoot(k as never), u, prefs.currency);
  const currency = label("value");
  const unitLabel = {
    cases: label("cases"),
    value: currency,
    outlets: label("outlets"),
  };

  return (
    <>
      <header className="flex flex-col gap-1 bg-brand px-5 py-4 text-white">
        <Link
          href="/app/history"
          className="flex min-h-11 w-fit items-center gap-1.5 text-[13px] font-medium text-on-brand-2 no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        >
          <ArrowLeft
            aria-hidden="true"
            size={18}
            strokeWidth={1.8}
            className="rtl:rotate-180"
          />
          {t("back")}
        </Link>
        <h1 className="m-0 text-[18px] font-bold">{title}</h1>
      </header>
      <main className="flex flex-1 flex-col gap-3 px-5 pb-4 pt-[18px]">
        {rows.length === 0 ? (
          <section
            aria-label={title}
            className="rounded-xl bg-brand-tint px-4 py-3.5"
          >
            <p className="m-0 text-sm text-ink-2">{t("emptyMonth")}</p>
          </section>
        ) : (
          <ul
            aria-label={t("daysLabel")}
            className="m-0 flex list-none flex-col gap-3 p-0"
          >
            {rows.map((row) => {
              if (row.kind === "gap") {
                const gapDate = new Date(`${row.date}T00:00:00Z`);
                return (
                  <li key={row.date}>
                    <Link
                      href={`/app/close?date=${row.date}`}
                      className="flex min-h-11 flex-col gap-0.5 rounded-xl border border-dashed border-line bg-white px-4 py-3 text-ink no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
                    >
                      <span className="text-[16px] font-bold">
                        {t("daySummary", {
                          weekday: weekday.format(gapDate),
                          day: gapDate.getUTCDate(),
                        })}
                      </span>
                      <span className="text-[14px] font-medium text-brand">
                        {t("gap")}
                      </span>
                    </Link>
                  </li>
                );
              }
              const d = row.day;
              const date = new Date(`${d.date}T00:00:00Z`);
              return (
                <li
                  key={d.date}
                  className="flex flex-col gap-2.5 rounded-xl border border-line bg-white px-4 py-3.5"
                >
                  <h2 className="m-0 text-[16px] font-bold">
                    {t("daySummary", {
                      weekday: weekday.format(date),
                      day: date.getUTCDate(),
                    })}
                  </h2>
                  <dl className="m-0 flex flex-col gap-1.5">
                    {[
                      ...lines,
                      ...Object.keys(d.lines)
                        .filter((id) => !lines.some((l) => l.lineId === id))
                        .map((id) => ({
                          lineId: id,
                          code: id,
                          nameAr: t("unknownLine"),
                          nameEn: t("unknownLine"),
                          nameUr: t("unknownLine"),
                          unit: "cases" as const,
                        })),
                    ]
                      .filter((l) => d.lines[l.lineId] !== undefined)
                      .map((l) => {
                        const a = d.admin[l.lineId];
                        const text = (n: number) =>
                          `${formatAmount(n, l.unit)} ${unitLabel[l.unit]}`;
                        return (
                          <div
                            key={l.lineId}
                            className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5"
                          >
                            <dt className="text-[14px] text-ink-2">
                              {lineName(l, locale as Locale)}
                            </dt>
                            <dd className="m-0 text-[15px] font-bold tabular-nums">
                              <bdi dir="ltr">
                                {formatAmount(d.lines[l.lineId]!, l.unit)}
                              </bdi>{" "}
                              <span className="text-[13px] font-medium text-ink-2">
                                {unitLabel[l.unit]}
                              </span>
                            </dd>
                            {a && (
                              <dd
                                dir="auto"
                                className="m-0 basis-full text-[13px] text-ink-2"
                              >
                                {t("adminNote", { amount: text(a.amount) })}
                                {a.repAmount !== null &&
                                  a.repAmount !== a.amount &&
                                  ` · ${t("repNote", { amount: text(a.repAmount) })}`}
                              </dd>
                            )}
                          </div>
                        );
                      })}
                  </dl>
                  <div className="flex items-baseline justify-between gap-3 border-t border-line-soft pt-2.5">
                    <span className="text-[14px] font-medium text-ink-2">
                      {t("cash")}
                    </span>
                    <span className="text-[15px] font-bold text-brand tabular-nums">
                      <bdi dir="ltr">
                        {formatAmount(d.cashToHandOver, "value")}
                      </bdi>{" "}
                      <span className="text-[13px] font-medium">
                        {currency}
                      </span>
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </>
  );
}
