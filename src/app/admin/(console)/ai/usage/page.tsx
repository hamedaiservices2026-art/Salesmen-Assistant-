import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import type { Locale } from "@/i18n/config";
import { aiDay, getAiUsage } from "@/server/admin/ai-usage";
import type { AiKind } from "@/server/ai/config";
import { requireRole } from "@/server/auth/guard";
import { getCompanyPrefs } from "@/server/repos/company";
import { Card } from "@/ui/admin/Card";
import { PageHeader } from "@/ui/admin/PageHeader";
import { secondaryButton } from "@/ui/admin/form-styles";
import { INTL_TAG } from "@/ui/intl-tag";

const KINDS: readonly AiKind[] = ["vision", "stt", "chat"];
const DAYS = 14;
const th = "whitespace-nowrap px-2 py-2.5 text-start text-[13px] font-semibold text-ink-2 first:ps-5 last:pe-5";
const td = "whitespace-nowrap px-2 py-2.5 tabular-nums first:ps-5 last:pe-5";

export default async function AdminAiUsagePage() {
  const ctx = await requireRole(["admin"]);
  const [t, locale, prefs] = await Promise.all([getTranslations("admin.ai"), getLocale() as Promise<Locale>, getCompanyPrefs(ctx)]);
  const usage = await getAiUsage({ ...ctx, timeZone: prefs.timeZone }, { today: aiDay(prefs.timeZone), days: DAYS });
  const lead = locale === "ur" ? "leading-[2.2]" : "";
  const nf = new Intl.NumberFormat(`${INTL_TAG[locale]}-u-nu-latn`);
  const dateFmt = new Intl.DateTimeFormat(`${INTL_TAG[locale]}-u-nu-latn`, { day: "numeric", month: "short", weekday: "short", timeZone: "UTC" });
  const state = usage.enabled ? (usage.envDisabled ? t("stateOnStopped") : t("stateOn")) : t("stateOff");
  const rows = [...new Set(usage.days.map((d) => d.date))].reverse().map((date) => {
    const of = (kind: AiKind) => usage.days.find((d) => d.date === date && d.kind === kind);
    return { date, ok: Object.fromEntries(KINDS.map((k) => [k, of(k)?.ok ?? 0])) as Record<AiKind, number>, failed: KINDS.reduce((a, k) => a + (of(k)?.failed ?? 0), 0) };
  });
  return (
    <main className="flex flex-col gap-5">
      <PageHeader
        title={t("usage.title")}
        subtitle={t("usage.subtitle")}
        actions={
          <Link href="/admin/ai" className={secondaryButton}>
            <ArrowRight aria-hidden="true" size={18} strokeWidth={2} className="rtl:rotate-0 ltr:rotate-180" />
            {t("usage.back")}
          </Link>
        }
      />
      <Card title={t("usage.stateTitle")}>
        <p className={`m-0 px-5 pb-5 text-[15px] font-semibold text-ink ${lead}`}>{state}</p>
      </Card>
      <Card title={t("usage.today.title")}>
        <ul className={`m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-4 px-5 pb-3 ${lead}`}>
          {usage.today.map((m) => {
            const pct = m.limit > 0 ? Math.min(100, Math.round((m.used / m.limit) * 100)) : 100;
            const hot = m.limit <= 0 || m.used * 10 >= m.limit * 9;
            return (
              <li key={m.kind} className={`flex flex-col gap-2 rounded-[12px] border p-4 ${hot ? "border-alert bg-alert-tint" : "border-line bg-white"}`}>
                <span className="text-[14px] font-semibold text-ink">{t(`usage.kinds.${m.kind}`)}</span>
                <span className={`text-[22px] font-bold tabular-nums ${hot ? "text-alert" : "text-ink"}`}>
                  {t("usage.today.of", { used: nf.format(m.used), limit: nf.format(m.limit) })}
                </span>
                <div
                  role="meter"
                  aria-valuemin={0}
                  aria-valuemax={m.limit}
                  aria-valuenow={Math.min(m.used, m.limit)}
                  aria-label={t("usage.today.meter", { kind: t(`usage.kinds.${m.kind}`), used: nf.format(m.used), limit: nf.format(m.limit) })}
                  className="h-2 overflow-hidden rounded bg-cell"
                >
                  <div className={`h-full ${hot ? "bg-alert" : "bg-brand"}`} style={{ inlineSize: `${pct}%` }} />
                </div>
              </li>
            );
          })}
        </ul>
        <p className={`m-0 px-5 pb-5 text-[13px] text-ink-2 ${lead}`}>{t("usage.today.note")}</p>
      </Card>
      <Card title={t("usage.days.title", { days: DAYS })} className="overflow-hidden">
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={t("usage.days.title", { days: DAYS })}>
          <table className="w-full min-w-[560px] border-collapse text-[14.5px]">
            <thead>
              <tr className="bg-canvas">
                <th scope="col" className={th}>{t("usage.days.cols.date")}</th>
                <th scope="col" className={th}>{t("usage.days.cols.vision")}</th>
                <th scope="col" className={th}>{t("usage.days.cols.stt")}</th>
                <th scope="col" className={th}>{t("usage.days.cols.chat")}</th>
                <th scope="col" className={th}>{t("usage.days.cols.failed")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.date} className="border-t border-line-soft">
                  <th scope="row" className={`${td} text-start font-semibold text-ink`}>{dateFmt.format(new Date(`${r.date}T00:00:00Z`))}</th>
                  {KINDS.map((k) => (
                    <td key={k} className={td}>{nf.format(r.ok[k])}</td>
                  ))}
                  <td className={`${td} ${r.failed > 0 ? "font-semibold text-alert" : ""}`}>{nf.format(r.failed)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card title={t("usage.failures.title")}>
        {usage.failures.length === 0 ? (
          <p className={`m-0 px-5 pb-5 text-[14.5px] text-ink-2 ${lead}`}>{t("usage.failures.none")}</p>
        ) : (
          <ul className={`m-0 flex list-none flex-col px-5 pb-4 ${lead}`}>
            {usage.failures.map((f) => (
              <li key={f.outcome} className="flex min-h-11 items-center justify-between gap-3 border-t border-line-soft py-2 text-[14.5px]">
                <span>{t(`usage.failures.outcome.${f.outcome}`)}</span>
                <span className="font-bold tabular-nums">{nf.format(f.count)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </main>
  );
}
