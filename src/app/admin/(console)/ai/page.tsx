import { Info } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { getCompanyAi } from "@/server/ai/consent";
import { requireRole } from "@/server/auth/guard";
import { Card } from "@/ui/admin/Card";
import { PageHeader } from "@/ui/admin/PageHeader";
import { AiSwitch } from "./ai-switch";

export default async function AdminAiPage() {
  const ctx = await requireRole(["admin"]);
  const [t, ai] = await Promise.all([getTranslations("admin.ai"), getCompanyAi(ctx)]);
  const points = t.raw("points") as string[];
  return (
    <main className="flex flex-col gap-5">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      {ai.envDisabled && (
        <div role="alert" className="flex items-start gap-3 rounded-[14px] border border-alert bg-alert-tint px-5 py-4 text-alert">
          <Info aria-hidden="true" size={20} strokeWidth={2} className="mt-0.5 shrink-0" />
          <div className="flex flex-col gap-0.5">
            <strong className="text-[15px]">{t("killSwitch")}</strong>
            <span className="text-[14px]">{t("killSwitchNote")}</span>
          </div>
        </div>
      )}
      <Card title={t("switchLabel")} aside={ai.enabled ? t("on") : t("off")}>
        <div className="flex flex-col gap-4 px-5 pb-5">
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
    </main>
  );
}
