import { getTranslations } from "next-intl/server";
import { getCompanySettings } from "@/server/admin/settings";
import { requireRole } from "@/server/auth/guard";
import { Card } from "@/ui/admin/Card";
import { PageHeader } from "@/ui/admin/PageHeader";
import { HolidaysCard, SettingsForm } from "./settings-forms";

export default async function SettingsPage() {
  const ctx = await requireRole(["admin"]);
  const [t, settings] = await Promise.all([getTranslations("admin.settings"), getCompanySettings(ctx)]);
  const { holidays, ...values } = settings;
  return (
    <main className="flex flex-col gap-5">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <Card title={t("company.title")}>
        <SettingsForm values={values} />
      </Card>
      <Card title={t("holidays.title")} aside={t("holidays.count", { count: holidays.length })}>
        <HolidaysCard holidays={holidays} />
      </Card>
    </main>
  );
}
