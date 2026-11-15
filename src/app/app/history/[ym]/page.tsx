import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { requireCtx } from "@/server/auth/guard";
import { getHistoryDays } from "@/server/repos/history";
import { loadLines } from "@/server/repos/month-data";
import { currentDay } from "@/server/today";
import { formatAmount } from "@/domain/money";
import { INTL_TAG } from "@/ui/intl-tag";

export default async function HistoryMonthPage({
  params,
}: {
  params: Promise<{ ym: string }>;
}) {
  const { ym } = await params;
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(ym);
  if (!match) notFound();
  const year = Number(match[1]);
  const month = Number(match[2]);

  const ctx = await requireCtx();
  const today = currentDay(ctx.timeZone);
  if (ym > today.slice(0, 7)) notFound();

  const [t, tHome, locale, days, lines] = await Promise.all([
    getTranslations("history"),
    getTranslations("home"),
    getLocale(),
    getHistoryDays(ctx, year, month),
    loadLines(ctx),
  ]);
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
  const currency = tHome("unit.value");
  const unitLabel = { cases: tHome("unit.cases"), value: currency };

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
        {days.length === 0 ? (
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
            {days.map((d) => {
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
                    {lines
                      .filter((l) => d.lines[l.lineId] !== undefined)
                      .map((l) => (
                        <div
                          key={l.lineId}
                          className="flex items-baseline justify-between gap-3"
                        >
                          <dt className="text-[14px] text-ink-2">
                            {locale === "en" ? l.nameEn : l.nameAr}
                          </dt>
                          <dd className="m-0 text-[15px] font-bold tabular-nums">
                            <bdi dir="ltr">
                              {formatAmount(d.lines[l.lineId]!, l.unit)}
                            </bdi>{" "}
                            <span className="text-[13px] font-medium text-ink-2">
                              {unitLabel[l.unit]}
                            </span>
                          </dd>
                        </div>
                      ))}
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
