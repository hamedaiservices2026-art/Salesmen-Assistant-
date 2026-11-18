"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ClipboardCheck, Clock, CreditCard, House, MessageSquare, Users } from "lucide-react";
import { useTranslations } from "next-intl";

const items = [
  { href: "/app", key: "home", Icon: House },
  { href: "/app/close", key: "close", Icon: ClipboardCheck },
  { href: "/app/commission", key: "commission", Icon: CreditCard },
  { href: "/app/assistant", key: "assistant", Icon: MessageSquare },
  { href: "/app/history", key: "history", Icon: Clock },
] as const;

/** Supervisors only: his reps and their coverage. */
const teamItem = { href: "/app/team", key: "team", Icon: Users } as const;

export function BottomNav({ showTeam = false }: { showTeam?: boolean }) {
  const t = useTranslations();
  const pathname = usePathname();
  return (
    <nav aria-label={t("home.navLabel")} className="sticky bottom-0 flex border-t border-line bg-white px-2 pb-3 pt-1.5">
      {(showTeam ? [...items, teamItem] : items).map(({ href, key, Icon }) => {
        const current = href === "/app" ? pathname === "/app" : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={current ? "page" : undefined}
            className={
              "flex min-h-11 flex-1 flex-col items-center gap-[3px] py-1.5 text-xs no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink " +
              (current ? "font-bold text-brand" : "font-medium text-ink-2")
            }
          >
            <Icon aria-hidden="true" size={24} strokeWidth={current ? 2 : 1.8} />
            {t(`nav.${key}`)}
          </Link>
        );
      })}
    </nav>
  );
}
