import { getLocale, getTranslations } from "next-intl/server";
import { isNotificationId } from "@/domain/assistant/explain";
import type { Locale } from "@/i18n/config";
import { requireCtx } from "@/server/auth/guard";
import { AI_NOTICE_VERSION } from "@/server/ai/availability";
import { aiStatus } from "@/server/ai/consent";
import { listMessages } from "@/server/assistant/conversation";
import { listNotifications } from "@/server/repos/notifications";
import { loadPolicySections } from "@/server/repos/policy-read";
import { currentDay } from "@/server/today";
import { AppHeader } from "@/ui/components/AppHeader";
import { INTL_TAG } from "@/ui/intl-tag";
import { Chat } from "./chat";

// The assistant's server action runs on this page: provider calls need up to 60 s (R33).
export const maxDuration = 60;

/** Incentive notices newer than this are shown at the top. */
const INCENTIVE_DAYS = 14;
const INCENTIVES_SHOWN = 2;

export default async function AssistantPage({ searchParams }: { searchParams: Promise<{ explain?: string | string[] }> }) {
  const ctx = await requireCtx();
  const [t, home, locale, params] = await Promise.all([getTranslations("assistant"), getTranslations("home"), getLocale(), searchParams]);
  const [chat, stt, messages, notifications, policies] = await Promise.all([
    aiStatus(ctx, "chat"),
    aiStatus(ctx, "stt"),
    listMessages(ctx),
    listNotifications(ctx),
    loadPolicySections(ctx),
  ]);
  const requested = Array.isArray(params.explain) ? params.explain[0] : params.explain;
  const explainId = isNotificationId(requested) ? requested : null;

  // "Last 14 days" counts from today in the company's time zone (the demo date override applies).
  const since = new Date(`${currentDay(ctx.timeZone)}T00:00:00Z`).getTime() - INCENTIVE_DAYS * 86_400_000;
  const when = new Intl.DateTimeFormat(`${INTL_TAG[locale as Locale] ?? "ar-EG"}-u-nu-latn`, {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: ctx.timeZone,
  });
  const incentives = notifications
    .filter((n) => n.kind === "incentive" && n.createdAt.getTime() >= since)
    .slice(0, INCENTIVES_SHOWN)
    .map((n) => ({ id: n.id, title: n.title, body: n.body, when: when.format(n.createdAt) }));

  return (
    <>
      <AppHeader greeting={t("title")} dateLine={t("subtitle")} notificationsLabel={home("notifications")} />
      <Chat
        stored={messages.map((m) => ({ id: m.id, role: m.role, text: m.text, verdict: m.verdict, citations: m.citations }))}
        incentives={incentives}
        hasPolicy={policies.some((d) => d.sections.length > 0)}
        chat={chat}
        stt={stt}
        noticeVersion={AI_NOTICE_VERSION}
        explainId={explainId}
      />
    </>
  );
}
