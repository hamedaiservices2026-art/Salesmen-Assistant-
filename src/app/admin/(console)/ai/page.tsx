import { Gauge, Info, ListChecks } from "lucide-react";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { getCompanyAi } from "@/server/ai/consent";
import { requireRole } from "@/server/auth/guard";
import { Card } from "@/ui/admin/Card";
import { PageHeader } from "@/ui/admin/PageHeader";
import { secondaryButton } from "@/ui/admin/form-styles";
import { AiSwitch } from "./ai-switch";

export default async function AdminAiPage() {
  const ctx = await requireRole(["admin"]);
  const [t, tp, ai, locale] = await Promise.all([getTranslations("admin.ai"), getTranslations("photos"), getCompanyAi(ctx), getLocale()]);
  // The notice's points, then where photos are kept and who sees them (the rep notice says the same).
  const points = [...(t.raw("points") as string[]), tp("keptAdmin")];
  // Nastaliq needs taller lines than the Latin and Arabic faces.
  const lead = locale === "ur" ? "leading-[2.2]" : "";
  const state = ai.enabled ? (ai.envDisabled ? t("stateOnStopped") : t("stateOn")) : t("stateOff");
  return (
    <main className="flex flex-col gap-5">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      {ai.envDisabled && (
        <div role="alert" className="flex items-start gap-3 rounded-[14px] border border-alert bg-alert-tint px-5 py-4 text-alert">
          <Info aria-hidden="true" size={20} strokeWidth={2} className="mt-0.5 shrink-0" />
          <div className={`flex flex-col gap-0.5 ${lead}`}>
            <strong className="text-[15px]">{t("killSwitch")}</strong>
            <span className="text-[14px]">{t("killSwitchNote")}</span>
          </div>
        </div>
      )}
      <Card title={t("switchLabel")}>
        <div className={`flex flex-col gap-4 px-5 pb-5 ${lead}`}>
          <p className="m-0 text-[15px] font-semibold text-ink">{state}</p>
          <p className="m-0 text-[15px] text-ink-2">{t("intro")}</p>
          <ul className="m-0 flex list-disc flex-col gap-2 ps-5 text-[15px] text-ink">
            {points.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
          <div>
            <AiSwitch enabled={ai.enabled} />
          </div>
        </div>
      </Card>
      <Card title={t("mappingLink.title")}>
        <div className={`flex flex-wrap items-center justify-between gap-4 px-5 pb-5 ${lead}`}>
          <p className="m-0 max-w-[60ch] text-[15px] text-ink-2">{t("mappingLink.body")}</p>
          <Link href="/admin/ai/mapping" className={secondaryButton}>
            <ListChecks aria-hidden="true" size={18} strokeWidth={2} />
            {t("mappingLink.open")}
          </Link>
        </div>
      </Card>
      <Card title={t("usageLink.title")}>
        <div className={`flex flex-wrap items-center justify-between gap-4 px-5 pb-5 ${lead}`}>
          <p className="m-0 max-w-[60ch] text-[15px] text-ink-2">{t("usageLink.body")}</p>
          <Link href="/admin/ai/usage" className={secondaryButton}>
            <Gauge aria-hidden="true" size={18} strokeWidth={2} />
            {t("usageLink.open")}
          </Link>
        </div>
      </Card>
    </main>
  );
}
