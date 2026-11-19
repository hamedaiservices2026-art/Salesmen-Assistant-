import { getLocale, getTranslations } from "next-intl/server";
import { coverageDays } from "@/domain/coverage";
import { lineName as localLineName } from "@/domain/lines";
import type { Locale } from "@/i18n/config";
import { requireCtx } from "@/server/auth/guard";
import { latestCoverage } from "@/server/repos/coverage";
import { loadLines } from "@/server/repos/month-data";
import { currentDay } from "@/server/today";
import { AppHeader } from "@/ui/components/AppHeader";
import { CoverageForm } from "@/ui/components/CoverageForm";
import { coverageSummary } from "@/ui/coverage-copy";
import { INTL_TAG } from "@/ui/intl-tag";
import { saveOwnCoverageAction } from "./actions";

const DAYS_BACK = 14;

/** The rep's own coverage form: one card per active coverage line. */
export default async function CoveragePage() {
  const ctx = await requireCtx();
  const [t, home, locale] = await Promise.all([getTranslations("coverage"), getTranslations("home"), getLocale()]);
  const today = currentDay(ctx.timeZone);
  const [year, month] = today.split("-").map(Number) as [number, number];
  const [lines, latest] = await Promise.all([loadLines(ctx), latestCoverage(ctx, year, month)]);
  const coverageLines = lines.filter((l) => l.kind === "coverage");
  const days = coverageDays(today, DAYS_BACK);
  const fmt = new Intl.DateTimeFormat(INTL_TAG[locale as keyof typeof INTL_TAG] ?? "ar-EG", {
    day: "numeric",
    month: "long",
    numberingSystem: "latn",
    timeZone: "UTC",
  });

  return (
    <>
      <AppHeader greeting={t("title")} notificationsLabel={home("notifications")} />
      <main className="flex flex-1 flex-col gap-4 px-5 pb-4 pt-[18px]">
        {coverageLines.length === 0 && <p className="m-0 text-base text-ink-2">{t("noLines")}</p>}
        {coverageLines.map((l) => {
          const info = latest.get(l.lineId);
          const summary = info ? coverageSummary(t, info, fmt.format(new Date(`${info.asOf}T00:00:00Z`))) : null;
          return (
            <section key={l.lineId} aria-label={localLineName(l, locale as Locale)} className="flex flex-col gap-3 rounded-[14px] border border-line px-4 py-4">
              <h2 className="m-0 text-[16px] font-bold">{localLineName(l, locale as Locale)}</h2>
              <p className="m-0 text-[13px] text-ink-2">{summary ? `${summary.figures} · ${summary.lastUpdate}` : t("none")}</p>
              <CoverageForm
                action={saveOwnCoverageAction}
                repId={ctx.userId}
                lineId={l.lineId}
                lineName={localLineName(l, locale as Locale)}
                initialCovered={info ? String(info.covered) : ""}
                initialTotal={info ? String(info.total) : ""}
                days={days}
              />
            </section>
          );
        })}
      </main>
    </>
  );
}
