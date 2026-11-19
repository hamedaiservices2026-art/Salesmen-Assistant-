import { getLocale, getTranslations } from "next-intl/server";
import { coverageDays } from "@/domain/coverage";
import { lineName as localLineName } from "@/domain/lines";
import type { Locale } from "@/i18n/config";
import { requireRole } from "@/server/auth/guard";
import { listCoverageReps } from "@/server/repos/coverage";
import { loadLines } from "@/server/repos/month-data";
import { currentDay } from "@/server/today";
import { AppHeader } from "@/ui/components/AppHeader";
import { CoverageForm } from "@/ui/components/CoverageForm";
import { coverageSummary } from "@/ui/coverage-copy";
import { INTL_TAG } from "@/ui/intl-tag";
import { saveTeamCoverageAction } from "./actions";

const DAYS_BACK = 14;

/** A supervisor's team: his reps, each with the latest coverage per coverage line and a form to update it. */
export default async function TeamPage() {
  const ctx = await requireRole(["supervisor"]);
  const [t, tc, home, locale] = await Promise.all([
    getTranslations("team"),
    getTranslations("coverage"),
    getTranslations("home"),
    getLocale(),
  ]);
  const today = currentDay(ctx.timeZone);
  const [year, month] = today.split("-").map(Number) as [number, number];
  const [reps, lines] = await Promise.all([listCoverageReps(ctx, year, month), loadLines(ctx)]);
  const coverageLines = lines.filter((l) => l.kind === "coverage");
  const days = coverageDays(today, DAYS_BACK);
  const tag = INTL_TAG[locale as keyof typeof INTL_TAG] ?? "ar-EG";
  const dateFmt = new Intl.DateTimeFormat(tag, { day: "numeric", month: "long", numberingSystem: "latn", timeZone: "UTC" });
  const monthName = new Intl.DateTimeFormat(tag, { month: "long", numberingSystem: "latn", timeZone: "UTC" }).format(
    new Date(`${today}T00:00:00Z`),
  );

  return (
    <>
      <AppHeader
        greeting={t("title")}
        dateLine={`${t("subtitle", { count: reps.length })} · ${t("month", { month: monthName })}`}
        notificationsLabel={home("notifications")}
      />
      <main className="flex flex-1 flex-col gap-4 px-5 pb-4 pt-[18px]">
        {reps.length === 0 && <p className="m-0 text-base text-ink-2">{t("empty")}</p>}
        {reps.length > 0 && coverageLines.length === 0 && <p className="m-0 text-base text-ink-2">{t("noLines")}</p>}
        {coverageLines.length > 0 &&
          reps.map((rep) => (
            <section key={rep.id} aria-label={rep.name} className="flex flex-col gap-4 rounded-[14px] border border-line px-4 py-4">
              <h2 className="m-0 text-[17px] font-bold">
                <bdi>{rep.name}</bdi>
              </h2>
              {coverageLines.map((l) => {
                const info = rep.coverage.get(l.lineId);
                const summary = info ? coverageSummary(tc, info, dateFmt.format(new Date(`${info.asOf}T00:00:00Z`))) : null;
                const name = localLineName(l, locale as Locale);
                return (
                  <div key={l.lineId} className="flex flex-col gap-2.5 border-t border-line-soft pt-3 first:border-t-0 first:pt-0">
                    <h3 className="m-0 text-[14.5px] font-semibold">{name}</h3>
                    <p className="m-0 text-[13px] text-ink-2">{summary ? `${summary.figures} · ${summary.lastUpdate}` : tc("none")}</p>
                    <CoverageForm
                      action={saveTeamCoverageAction}
                      repId={rep.id}
                      lineId={l.lineId}
                      lineName={`${rep.name} · ${name}`}
                      initialCovered={info ? String(info.covered) : ""}
                      initialTotal={info ? String(info.total) : ""}
                      days={days}
                    />
                  </div>
                );
              })}
            </section>
          ))}
      </main>
    </>
  );
}
