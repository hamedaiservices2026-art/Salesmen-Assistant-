import Link from "next/link";
import { Bell } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { currentCtx } from "@/server/auth/guard";
import { unreadCount } from "@/server/repos/notifications";

/** The bell in the app header: a link to the notifications page with the signed-in rep's unread count. */
export async function NotificationBell({ label }: { label: string }) {
  const ctx = await currentCtx();
  const count = ctx ? await unreadCount(ctx) : 0;
  const t = await getTranslations("home");
  return (
    <Link
      href="/app/notifications"
      aria-label={count > 0 ? t("notificationsUnread", { count }) : label}
      className="relative flex size-11 shrink-0 items-center justify-center rounded-xl bg-white/14 text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
    >
      <Bell aria-hidden="true" size={22} strokeWidth={1.8} />
      {count > 0 && (
        <span
          aria-hidden="true"
          className="absolute -end-1 -top-1 flex min-w-[20px] items-center justify-center rounded-full bg-white px-1.5 text-[12px] font-bold leading-5 tabular-nums text-brand"
        >
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Link>
  );
}
