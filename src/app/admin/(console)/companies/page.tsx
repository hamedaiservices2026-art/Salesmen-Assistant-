import { getLocale, getTranslations } from "next-intl/server";
import { listCompanies } from "@/server/admin/companies";
import { requireRole } from "@/server/auth/guard";
import { INTL_TAG } from "@/ui/intl-tag";
import { Card } from "@/ui/admin/Card";
import { PageHeader } from "@/ui/admin/PageHeader";
import type { Locale } from "@/i18n/config";
import { NewCompanyForm } from "./new-company-form";

export default async function CompaniesPage() {
  const ctx = await requireRole(["owner"]);
  const [t, locale, companies] = await Promise.all([
    getTranslations("admin.companies"),
    getLocale() as Promise<Locale>,
    listCompanies(ctx),
  ]);
  const date = new Intl.DateTimeFormat(`${INTL_TAG[locale]}-u-nu-latn`, { dateStyle: "medium", timeZone: ctx.timeZone });
  const th = "px-5 py-2.5 text-start text-[13px] font-semibold text-ink-2";
  return (
    <main className="flex flex-col gap-5">
      <PageHeader title={t("title")} subtitle={t("subtitle", { count: companies.length })} />
      <div className="flex flex-wrap items-start gap-5">
        <Card title={t("listTitle")} className="min-w-[520px] flex-[3_1_560px] overflow-hidden">
          {companies.length === 0 ? (
            <p className="m-0 px-5 pb-5 text-[15px] text-ink-2">{t("empty")}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[14.5px]">
                <thead>
                  <tr className="bg-canvas">
                    <th scope="col" className={th}>{t("cols.name")}</th>
                    <th scope="col" className={th}>{t("cols.currency")}</th>
                    <th scope="col" className={th}>{t("cols.admins")}</th>
                    <th scope="col" className={th}>{t("cols.reps")}</th>
                    <th scope="col" className={th}>{t("cols.created")}</th>
                  </tr>
                </thead>
                <tbody>
                  {companies.map((c) => (
                    <tr key={c.id} className="border-t border-line-soft">
                      <th scope="row" className="px-5 py-3 text-start font-semibold text-ink"><bdi>{c.name}</bdi></th>
                      <td className="px-5 py-3 text-ink-2">{c.currency}</td>
                      <td className="px-5 py-3 tabular-nums">{c.adminCount}</td>
                      <td className="px-5 py-3 tabular-nums">{c.repCount}</td>
                      <td className="px-5 py-3 text-ink-2">{date.format(c.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <Card title={t("new.title")} className="min-w-[320px] flex-[2_1_360px]">
          <NewCompanyForm />
        </Card>
      </div>
    </main>
  );
}
