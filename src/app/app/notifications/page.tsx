import { after } from "next/server";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Megaphone } from "lucide-react";
import { explainHref, explainOffered } from "@/domain/assistant/explain";
import type { Locale } from "@/i18n/config";
import { aiStatus } from "@/server/ai/consent";
import { requireCtx } from "@/server/auth/guard";
import { LIST_MAX, listNotifications, markAllRead } from "@/server/repos/notifications";
import { AppHeader } from "@/ui/components/AppHeader";
import { INTL_TAG } from "@/ui/intl-tag";

/**
 * The rep's notifications, newest first. The list is read first and drawn as it was (unread ones
 * highlighted); the write that marks exactly the rendered ones read runs after the response is sent, so the next visit and the
 * bell show everything read.
 */
export default async function NotificationsPage() {
  const ctx = await requireCtx();
  const [t, home, locale] = await Promise.all([getTranslations("notifications"), getTranslations("home"), getLocale()]);
  const [items, chat] = await Promise.all([listNotifications(ctx), aiStatus(ctx, "chat")]);
  // "Explain simply" is offered when the assistant would answer (or would after the notice is accepted).
  const canExplain = explainOffered(chat);
  const unreadIds = items.filter((n) => !n.read).map((n) => n.id);
  // A full list may hide older unread ones: they are marked too, so the bell clears.
  const upTo = items.length >= LIST_MAX ? items[items.length - 1]!.createdAt : undefined;
  if (unreadIds.length > 0 || upTo) after(() => markAllRead(ctx, unreadIds, { upTo }));

  const when = new Intl.DateTimeFormat(`${INTL_TAG[locale as Locale] ?? "ar-EG"}-u-nu-latn`, {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: ctx.timeZone,
  });

  return (
    <>
      <AppHeader greeting={t("title")} notificationsLabel={home("notifications")} unreadCount={0} />
      <main className="flex flex-1 flex-col gap-3 px-5 pb-4 pt-[18px]">
        {items.length === 0 && (
          <section aria-label={t("emptyTitle")} className="flex flex-col gap-1.5 rounded-xl bg-brand-tint px-4 py-3.5">
            <h2 className="m-0 text-[15px] font-bold">{t("emptyTitle")}</h2>
            <p className="m-0 text-sm text-ink-2">{t("emptyBody")}</p>
          </section>
        )}
        {items.map((n) => (
          <article
            key={n.id}
            className={`flex flex-col gap-2.5 rounded-[14px] border px-4 py-4 ${n.read ? "border-line bg-white" : "border-brand bg-brand-tint"}`}
          >
            <div className="flex items-center justify-between gap-3 text-[12.5px] text-ink-2">
              <span className="flex items-center gap-1.5 font-semibold text-brand">
                <Megaphone aria-hidden="true" size={16} strokeWidth={1.8} />
                {t("kind.incentive")}
              </span>
              <span className="flex items-center gap-2">
                {!n.read && <span className="rounded-full bg-brand px-2 py-0.5 text-[12px] font-semibold text-white">{t("new")}</span>}
                <time dateTime={n.createdAt.toISOString()} className="tabular-nums">
                  {when.format(n.createdAt)}
                </time>
              </span>
            </div>
            <h2 className="m-0 text-[16px] font-bold">
              <bdi>{n.title}</bdi>
            </h2>
            <p className="m-0 whitespace-pre-line text-[14.5px] leading-relaxed text-ink">{n.body}</p>
            <div className="flex flex-wrap gap-2">
              {canExplain && explainHref(n.id) !== null && (
                <Link
                  href={explainHref(n.id)!}
                  className="flex min-h-11 min-w-40 flex-1 items-center justify-center rounded-xl border-0 bg-brand px-4 py-2 text-center text-[14.5px] font-bold text-white no-underline hover:bg-brand-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                >
                  {t("explain")}
                </Link>
              )}
              <Link
                href="/app/commission"
                className="flex min-h-11 min-w-40 flex-1 items-center justify-center rounded-xl border border-brand bg-white px-4 py-2 text-center text-[14.5px] font-bold text-brand no-underline hover:bg-brand-tint focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
              >
                {t("learnMore")}
              </Link>
            </div>
          </article>
        ))}
      </main>
    </>
  );
}
