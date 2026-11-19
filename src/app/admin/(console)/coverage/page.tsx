import { getLocale, getTranslations } from "next-intl/server";
import { coverageDays } from "@/domain/coverage";
import { lineName as localLineName } from "@/domain/lines";
import type { Locale } from "@/i18n/config";
import { requireRole } from "@/server/auth/guard";
import { listCoverageReps } from "@/server/repos/coverage";
import { loadLines } from "@/server/repos/month-data";
import { currentDay } from "@/server/today";
import { Card } from "@/ui/admin/Card";
import { PageHeader } from "@/ui/admin/PageHeader";
import { CoverageForm } from "@/ui/components/CoverageForm";
import { coverageSummary } from "@/ui/coverage-copy";
import { INTL_TAG } from "@/ui/intl-tag";
import { saveAdminCoverageAction } from "./actions";

const DAYS_BACK = 14;

/** Every active rep of the company with the latest coverage of the month per coverage line, and a form to update it. */
export default async function AdminCoveragePage() {
  const ctx = await requireRole(["admin"]);
  const [t, tc, locale] = await Promise.all([getTranslations("admin.coverage"), getTranslations("coverage"), getLocale()]);
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
    <main className="flex flex-col gap-5">
      <PageHeader title={t("title")} subtitle={t("subtitle", { month: monthName })} />
      {reps.length === 0 && <p className="m-0 text-base text-ink-2">{t("empty")}</p>}
      {reps.length > 0 && coverageLines.length === 0 && <p className="m-0 text-base text-ink-2">{t("noLines")}</p>}
      {coverageLines.length > 0 && (
        <div className="grid grid-cols-2 items-start gap-5 max-[1100px]:grid-cols-1">
          {reps.map((rep) => (
            <Card key={rep.id} title={rep.name}>
              <div className="flex flex-col gap-5 px-5 pb-5">
                {coverageLines.map((l) => {
                  const info = rep.coverage.get(l.lineId);
                  const summary = info ? coverageSummary(tc, info, dateFmt.format(new Date(`${info.asOf}T00:00:00Z`))) : null;
                  const name = localLineName(l, locale as Locale);
                  return (
                    <div key={l.lineId} className="flex flex-col gap-2.5">
                      <h3 className="m-0 text-[14.5px] font-semibold">{name}</h3>
                      <p className="m-0 text-[13px] text-ink-2">{summary ? `${summary.figures} · ${summary.lastUpdate}` : tc("none")}</p>
                      <CoverageForm
                        action={saveAdminCoverageAction}
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
              </div>
            </Card>
          ))}
        </div>
      )}
    </main>
  );
}
