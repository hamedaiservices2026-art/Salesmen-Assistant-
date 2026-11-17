import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { requireRole } from "@/server/auth/guard";
import { Card } from "@/ui/admin/Card";
import { PageHeader } from "@/ui/admin/PageHeader";

/** Placeholder until the team overview (Task 20). An owner has no overview: his only page is the companies list. */
export default async function AdminOverviewPage() {
  const ctx = await requireRole(["admin", "owner"]);
  if (ctx.role === "owner") redirect("/admin/companies");
  const t = await getTranslations("admin.overview");
  return (
    <main className="flex flex-col gap-5">
      <PageHeader title={t("title")} />
      <Card label={t("title")} className="px-5 py-6">
        <p className="m-0 text-base text-ink-2">{t("placeholder")}</p>
      </Card>
    </main>
  );
}
