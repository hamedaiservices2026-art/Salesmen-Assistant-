import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getDb } from "@/db/client";
import { isSetupOpen } from "@/server/admin/setup";
import { AdminAuthShell } from "@/ui/admin-auth-shell";
import { SetupForm } from "./setup-form";

// Reads the environment and the database on every request; never prerendered.
export const dynamic = "force-dynamic";

/** One-time owner setup: a plain 404 unless SETUP_TOKEN is set (32+ characters) and no owner exists. */
export default async function SetupPage() {
  if (!(await isSetupOpen(await getDb(), process.env))) notFound();
  const t = await getTranslations("setup");
  return (
    <AdminAuthShell title={t("heading")}>
      <SetupForm />
    </AdminAuthShell>
  );
}
