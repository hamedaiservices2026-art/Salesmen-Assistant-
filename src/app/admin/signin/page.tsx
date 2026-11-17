import { getTranslations } from "next-intl/server";
import { AdminAuthShell } from "@/ui/admin-auth-shell";
import { AdminSignInForm } from "./signin-form";

export default async function AdminSignInPage() {
  const t = await getTranslations("admin.auth");
  return (
    <AdminAuthShell title={t("signin.heading")}>
      <AdminSignInForm />
    </AdminAuthShell>
  );
}
