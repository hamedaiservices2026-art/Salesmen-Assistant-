import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getDb } from "@/db/client";
import { isSetupOpen } from "@/server/admin/setup";
import { AdminAuthShell } from "@/ui/admin-auth-shell";
import { SetupForm } from "./setup-form";

// Reads the environment and the database on every request; never prerendered.
// Being dynamic, the page and its action are sent with Next's `Cache-Control: private, no-cache,
// no-store`. No /setup-only header rule on purpose: a closed /setup then answers with exactly the
// headers of any unknown route's 404 (Next already marks 404 pages noindex).
export const dynamic = "force-dynamic";

/** The open page is never indexed. */
export const metadata: Metadata = { robots: { index: false, follow: false } };

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
