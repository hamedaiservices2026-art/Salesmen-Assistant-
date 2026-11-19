import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { LOCALE_ENDONYM, type Locale } from "@/i18n/config";
import { getPolicy, listPolicies } from "@/server/admin/policies";
import { requireRole } from "@/server/auth/guard";
import { Card } from "@/ui/admin/Card";
import { PageHeader } from "@/ui/admin/PageHeader";
import { secondaryButton } from "@/ui/admin/form-styles";
import { INTL_TAG } from "@/ui/intl-tag";
import { DeletePolicyButton } from "./delete-button";
import { PolicyEditor } from "./policy-editor";

export default async function PoliciesPage({ searchParams }: { searchParams: Promise<{ edit?: string; saved?: string }> }) {
  const ctx = await requireRole(["admin"]);
  const [t, locale, { edit, saved }] = await Promise.all([getTranslations("admin.policies"), getLocale() as Promise<Locale>, searchParams]);
  const rows = await listPolicies(ctx);
  // An id that is not this company's policy just opens the "new policy" form.
  const found = edit ? await getPolicy(ctx, edit) : null;
  const editing = found?.ok ? found.policy : null;
  const tag = `${INTL_TAG[locale]}-u-nu-latn`;
  const nf = new Intl.NumberFormat(tag);
  const stamp = new Intl.DateTimeFormat(tag, { dateStyle: "medium", timeZone: ctx.timeZone });
  const th = "px-4 py-2.5 text-start text-[13px] font-semibold text-ink-2";

  return (
    <main className="flex flex-col gap-5">
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        actions={
          editing ? (
            <Link href="/admin/policies" className={secondaryButton}>
              {t("newPolicy")}
            </Link>
          ) : undefined
        }
      />
      <Card title={editing ? t("editTitle") : t("newTitle")}>
        <PolicyEditor
          key={editing ? `${editing.id}-${editing.version}` : "new"}
          item={editing ? { id: editing.id, version: editing.version, title: editing.title, locale: editing.locale, body: editing.body } : null}
          justSaved={Boolean(editing) && saved === "1"}
          defaultLocale={locale}
        />
      </Card>
      <Card title={t("list.title")} aside={t("list.aside", { count: nf.format(rows.length) })} className="overflow-hidden">
        {rows.length === 0 ? (
          <p className="m-0 px-5 pb-5 text-[14.5px] text-ink-2">{t("list.empty")}</p>
        ) : (
          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={t("list.title")}>
            <table className="w-full border-collapse text-[14.5px]">
              <thead>
                <tr className="bg-canvas">
                  <th scope="col" className={th}>{t("cols.title")}</th>
                  <th scope="col" className={th}>{t("cols.locale")}</th>
                  <th scope="col" className={th}>{t("cols.sections")}</th>
                  <th scope="col" className={th}>{t("cols.updated")}</th>
                  <th scope="col" className={th}>
                    <span className="sr-only">{t("cols.actions")}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id} className="border-t border-line-soft align-middle">
                    <th scope="row" className="px-4 py-2.5 text-start font-semibold text-ink">
                      <bdi>{p.title}</bdi>
                    </th>
                    <td className="px-4 py-2.5 text-ink-2">{LOCALE_ENDONYM[p.locale]}</td>
                    <td className="px-4 py-2.5 tabular-nums text-ink-2">{nf.format(p.sectionsCount)}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 tabular-nums text-ink-2">{stamp.format(p.updatedAt)}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex flex-wrap justify-end gap-2">
                        <Link href={`/admin/policies?edit=${encodeURIComponent(p.id)}`} className={secondaryButton}>
                          {t("edit")}
                        </Link>
                        <DeletePolicyButton id={p.id} title={p.title} />
                      </div>
                    </td>
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
