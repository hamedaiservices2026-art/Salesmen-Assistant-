import { getLocale, getTranslations } from "next-intl/server";
import type { Locale } from "@/i18n/config";
import { listUploads } from "@/server/admin/uploads";
import { requireRole } from "@/server/auth/guard";
import { Card } from "@/ui/admin/Card";
import { PageHeader } from "@/ui/admin/PageHeader";
import { INTL_TAG } from "@/ui/intl-tag";
import { UploadCard } from "./upload-card";

const RECENT = 20;

export default async function UploadsPage() {
  const ctx = await requireRole(["admin"]);
  const [t, locale, recent] = await Promise.all([
    getTranslations("admin.uploads"),
    getLocale() as Promise<Locale>,
    listUploads(ctx, { limit: RECENT }),
  ]);
  const stamp = new Intl.DateTimeFormat(`${INTL_TAG[locale]}-u-nu-latn`, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: ctx.timeZone,
  });
  return (
    <main className="flex flex-col gap-5">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <UploadCard kind="targets" />
        <UploadCard kind="daily" />
      </div>
      <Card title={t("recent.title")} aside={t("recent.aside", { count: RECENT })} className="overflow-hidden">
        {recent.length === 0 ? (
          <p className="m-0 px-5 pb-5 text-[14.5px] text-ink-2">{t("recent.empty")}</p>
        ) : (
          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={t("recent.title")}>
            <table className="w-full border-collapse text-[14px]">
              <thead>
                <tr className="border-y border-line text-[13px] text-ink-2">
                  {(["when", "kind", "file", "rows", "errors", "status", "by"] as const).map((c) => (
                    <th key={c} scope="col" className="whitespace-nowrap px-4 py-2.5 text-start font-semibold">
                      {t(`recent.cols.${c}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recent.map((u) => (
                  <tr key={u.id} className="border-b border-line last:border-b-0">
                    <td className="whitespace-nowrap px-4 py-2.5 tabular-nums text-ink-2">{stamp.format(u.createdAt)}</td>
                    <td className="px-4 py-2.5 text-ink">{t(`recent.kind.${u.kind}`)}</td>
                    <td className="px-4 py-2.5 text-ink" dir="auto">
                      {u.filename}
                    </td>
                    <td className="px-4 py-2.5 tabular-nums text-ink-2">{u.rows}</td>
                    <td className="px-4 py-2.5 tabular-nums text-ink-2">{u.errorCount}</td>
                    <td className={`whitespace-nowrap px-4 py-2.5 font-semibold ${u.applied ? "text-brand" : "text-alert"}`}>
                      {u.applied ? t("recent.status.applied") : t("recent.status.notApplied")}
                    </td>
                    <td className="px-4 py-2.5 text-ink-2">{u.byName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </main>
  );
}
