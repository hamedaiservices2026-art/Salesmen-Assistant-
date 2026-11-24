import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import type { Locale } from "@/i18n/config";
import { getFieldMap } from "@/server/ai/field-map";
import { requireRole } from "@/server/auth/guard";
import { Card } from "@/ui/admin/Card";
import { PageHeader } from "@/ui/admin/PageHeader";
import { secondaryButton } from "@/ui/admin/form-styles";
import { MappingForm } from "./mapping-form";

export default async function AiMappingPage({ searchParams }: { searchParams: Promise<{ saved?: string }> }) {
  const ctx = await requireRole(["admin"]);
  const locale = (await getLocale()) as Locale;
  const [t, { saved }, map] = await Promise.all([getTranslations("admin.ai.mapping"), searchParams, getFieldMap(ctx, locale)]);
  return (
    <main className="flex flex-col gap-5">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          <Link href="/admin/ai" className={secondaryButton}>
            <ArrowRight aria-hidden="true" size={18} strokeWidth={2} className="rtl:rotate-0 ltr:rotate-180" />
            {t("back")}
          </Link>
        }
      />
      <Card title={t("cardTitle")}>
        <MappingForm key={map.version} version={map.version} fields={map.keys} aliases={map.aliases} justSaved={saved === "1"} />
      </Card>
    </main>
  );
}
