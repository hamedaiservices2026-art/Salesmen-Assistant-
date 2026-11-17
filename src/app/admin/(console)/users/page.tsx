import { getLocale, getTranslations } from "next-intl/server";
import type { Locale } from "@/i18n/config";
import { listUsers } from "@/server/admin/users";
import { requireRole } from "@/server/auth/guard";
import { Card } from "@/ui/admin/Card";
import { PageHeader } from "@/ui/admin/PageHeader";
import { CreateUserForm, UserTable } from "./user-forms";

export default async function UsersPage() {
  const ctx = await requireRole(["admin"]);
  const [t, locale, users] = await Promise.all([
    getTranslations("admin.users"),
    getLocale() as Promise<Locale>,
    listUsers(ctx),
  ]);
  const supervisors = users.filter((u) => u.role === "supervisor" && u.active).map((u) => ({ id: u.id, name: u.name }));
  return (
    <main className="flex flex-col gap-5">
      <PageHeader title={t("title")} subtitle={t("subtitle", { count: users.length })} />
      <Card title={t("new.title")}>
        <CreateUserForm supervisors={supervisors} defaultLocale={locale} />
      </Card>
      <Card title={t("listTitle")} className="overflow-hidden">
        <UserTable rows={users} supervisors={supervisors} />
      </Card>
    </main>
  );
}
