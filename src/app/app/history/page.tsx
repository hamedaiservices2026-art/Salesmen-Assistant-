import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { requireCtx } from "@/server/auth/guard";
import { getHistoryMonths } from "@/server/repos/history";
import { loadLines, loadScheme } from "@/server/repos/month-data";
import { formatAmount } from "@/domain/money";
import { INTL_TAG } from "@/ui/intl-tag";

export default async function HistoryPage() {
  const ctx = await requireCtx();
  const [t, tHome, locale, months, lines] = await Promise.all([
    getTranslations("history"),
    getTranslations("home"),
    getLocale(),
    getHistoryMonths(ctx),
    loadLines(ctx),
  ]);
  // A month without a published scheme shows no commission, not zero.
  const hasScheme = await Promise.all(
    months.map(async (m) => (await loadScheme(ctx, m.year, m.month)) !== null),
  );
  const names = new Map(
    lines.map((l) => [l.lineId, locale === "en" ? l.nameEn : l.nameAr]),
  );
  const loc = locale as keyof typeof INTL_TAG;
  const monthTitle = new Intl.DateTimeFormat(INTL_TAG[loc] ?? "ar-EG", {
    month: "long",
    year: "numeric",
    numberingSystem: "latn",
    timeZone: "UTC",
  });
  const currency = tHome("unit.value");

  return (
    <>
      <header className="flex flex-col gap-0.5 bg-brand px-5 py-4 text-white">
        <h1 className="m-0 text-[18px] font-bold">{t("title")}</h1>
        <p className="m-0 text-[12.5px] text-on-brand-2">{t("sub")}</p>
      </header>
      <main className="flex flex-1 flex-col gap-3 px-5 pb-4 pt-[18px]">
        {months.length === 0 ? (
          <section
            aria-label={t("title")}
            className="rounded-xl bg-brand-tint px-4 py-3.5"
          >
            <p className="m-0 text-sm text-ink-2">{t("empty")}</p>
          </section>
        ) : (
          <ul
            aria-label={t("monthsLabel")}
            className="m-0 flex list-none flex-col gap-3 p-0"
          >
            {months.map((m, i) => {
              const title = monthTitle.format(
                new Date(Date.UTC(m.year, m.month - 1, 1)),
              );
              const ym = `${m.year}-${String(m.month).padStart(2, "0")}`;
              return (
                <li key={ym}>
                  <Link
                    href={`/app/history/${ym}`}
                    aria-label={t("openMonth", { month: title })}
                    className="flex min-h-11 flex-col gap-3 rounded-xl border border-line bg-white px-4 py-3.5 text-ink no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[16px] font-bold">{title}</span>
                      <ChevronRight
                        aria-hidden="true"
                        size={20}
                        strokeWidth={1.8}
                        className="text-muted rtl:rotate-180"
                      />
                    </div>
                    <dl className="m-0 flex flex-col gap-1.5">
                      {m.lines.map((l) => (
                        <div
                          key={l.lineId}
                          className="flex items-baseline justify-between gap-3"
                        >
                          <dt className="text-[14px] text-ink-2">
                            {names.get(l.lineId) ?? l.lineId}
                          </dt>
                          <dd className="m-0 text-[15px] font-bold tabular-nums">
                            <bdi dir="ltr">
                              {l.pct === null ? "—" : `${l.pct}%`}
                            </bdi>
                          </dd>
                        </div>
                      ))}
                    </dl>
                    <div className="flex items-baseline justify-between gap-3 border-t border-line-soft pt-3">
                      <span className="text-[14px] font-medium text-ink-2">
                        {t("commission")}
                      </span>
                      <span className="text-[17px] font-extrabold text-brand tabular-nums">
                        {hasScheme[i] ? (
                          <>
                            <bdi dir="ltr">
                              {formatAmount(m.commission, "value")}
                            </bdi>{" "}
                            <span className="text-[13px] font-medium">
                              {currency}
                            </span>
                          </>
                        ) : (
                          "—"
                        )}
                      </span>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </>
  );
}
