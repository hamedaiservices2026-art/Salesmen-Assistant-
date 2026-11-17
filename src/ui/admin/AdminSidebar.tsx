"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut } from "lucide-react";
import { useTranslations } from "next-intl";
import type { Locale } from "@/i18n/config";
import type { Role } from "@/server/auth/roles";
import { adminSignOutAction, setAdminLocaleAction } from "@/app/admin/actions";
import { LocaleSelect } from "./LocaleSelect";
import { navFor } from "./nav";

/** Brand-blue side column: product and company name, the sections, then language and sign out. */
export function AdminSidebar({ role, companyName, locale }: { role: Role; companyName: string; locale: Locale }) {
  const t = useTranslations();
  const pathname = usePathname();
  return (
    <aside className="flex w-60 shrink-0 flex-col gap-6 bg-brand px-4 py-6 text-white max-[1100px]:w-52">
      <div className="flex flex-col gap-0.5 px-2">
        <span className="text-lg font-bold">{t("app.name")}</span>
        <span className="truncate text-[13px] text-on-brand-2">
          <bdi>{companyName}</bdi>
        </span>
      </div>
      <nav aria-label={t("admin.shell.navLabel")} className="flex flex-1 flex-col gap-1">
        {navFor(role).map(({ href, key, Icon }) => {
          const current = href === "/admin" ? pathname === "/admin" : pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={href}
              href={href}
              aria-current={current ? "page" : undefined}
              className={
                "flex min-h-11 items-center gap-2.5 rounded-[10px] px-3 text-[14.5px] no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white " +
                (current ? "bg-white font-semibold text-brand" : "font-medium text-white hover:bg-white/14")
              }
            >
              <Icon aria-hidden="true" size={20} strokeWidth={current ? 2 : 1.8} className="shrink-0" />
              {t(`admin.nav.${key}`)}
            </Link>
          );
        })}
      </nav>
      <div className="flex flex-col gap-2 border-t border-white/20 pt-4">
        <LocaleSelect
          locale={locale}
          label={t("admin.shell.languageLabel")}
          action={setAdminLocaleAction}
        />
        <form action={adminSignOutAction}>
          <button
            type="submit"
            className="flex min-h-11 w-full items-center gap-2.5 rounded-[10px] border-0 bg-transparent px-3 text-start text-[14.5px] font-medium text-white hover:bg-white/14 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            <LogOut aria-hidden="true" size={20} strokeWidth={1.8} className="shrink-0" />
            {t("admin.shell.signOut")}
          </button>
        </form>
      </div>
    </aside>
  );
}
