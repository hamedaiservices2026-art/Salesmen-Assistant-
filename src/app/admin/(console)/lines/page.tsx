import { getTranslations } from "next-intl/server";
import { listAllLines } from "@/server/admin/lines";
import { requireRole } from "@/server/auth/guard";
import { Card } from "@/ui/admin/Card";
import { PageHeader } from "@/ui/admin/PageHeader";
import { LineForm, LineTable } from "./line-forms";

export default async function LinesPage({ searchParams }: { searchParams: Promise<{ edit?: string }> }) {
  const ctx = await requireRole(["admin"]);
  const [t, lines, { edit }] = await Promise.all([
    getTranslations("admin.lines"),
    listAllLines(ctx),
    searchParams,
  ]);
  // An id that is not one of this company's lines just opens the "new line" form.
  const editing = lines.find((l) => l.lineId === edit);
  return (
    <main className="flex flex-col gap-5">
      <PageHeader title={t("title")} subtitle={t("subtitle", { count: lines.length })} />
      <Card title={editing ? t("form.editTitle") : t("form.newTitle")}>
        <LineForm key={editing?.lineId ?? "new"} line={editing ?? null} />
      </Card>
      <Card title={t("listTitle")} className="overflow-hidden">
        <LineTable rows={lines} />
      </Card>
    </main>
  );
}
