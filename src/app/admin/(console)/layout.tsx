import { eq } from "drizzle-orm";
import { getLocale } from "next-intl/server";
import type { Locale } from "@/i18n/config";
import * as s from "@/db/schema";
import { requireRole } from "@/server/auth/guard";
import { AdminSidebar } from "@/ui/admin/AdminSidebar";

/** Every console page: admins and owners only; the sidebar shows the owner's or the admin's sections. */
export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireRole(["admin", "owner"]);
  // The language in use (the cookie), which can differ from the stored profile language for a moment.
  const locale = (await getLocale()) as Locale;
  const [company] = await ctx.db
    .select({ name: s.companies.name })
    .from(s.companies)
    .where(eq(s.companies.id, ctx.companyId));
  return (
    <div className="admin-console flex min-h-dvh bg-canvas text-ink">
      <AdminSidebar role={ctx.role} companyName={company?.name ?? ""} locale={locale} />
      <div className="flex min-w-0 flex-1 flex-col gap-5 px-8 pb-10 pt-7 max-[1100px]:px-5">{children}</div>
    </div>
  );
}
