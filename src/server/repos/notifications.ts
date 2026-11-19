import { and, count, desc, eq, inArray, isNull, lte, or, type SQL } from "drizzle-orm";
import * as s from "@/db/schema";
import { assertOwnContext } from "@/server/auth/roles";
import type { Ctx } from "@/server/ctx";

export type NotificationView = { id: string; kind: "incentive"; title: string; body: string; createdAt: Date; read: boolean };

/** How many notifications the list shows; a list this long may hide older unread ones. */
export const LIST_MAX = 100;

/** The text in the locale, the Arabic text when that one is missing or blank. Plain text: callers render it as text, never as HTML. */
export function pickText(text: s.LocalText, locale: Ctx["locale"]): string {
  const chosen = locale === "ar" ? undefined : text[locale];
  return typeof chosen === "string" && chosen.trim() !== "" ? chosen : String(text.ar ?? "");
}

const own = (ctx: Ctx) => and(eq(s.notifications.userId, ctx.userId), eq(s.notifications.companyId, ctx.companyId));

/** The caller's own notifications, newest first (at most 100), with title and body in his language. */
export async function listNotifications(ctx: Ctx): Promise<NotificationView[]> {
  const rows = await ctx.db
    .select()
    .from(s.notifications)
    .where(own(ctx))
    .orderBy(desc(s.notifications.createdAt), desc(s.notifications.id))
    .limit(LIST_MAX);
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    title: pickText(r.title, ctx.locale),
    body: pickText(r.body, ctx.locale),
    createdAt: r.createdAt,
    read: r.readAt !== null,
  }));
}

export async function unreadCount(ctx: Ctx): Promise<number> {
  const [row] = await ctx.db
    .select({ n: count() })
    .from(s.notifications)
    .where(and(own(ctx), isNull(s.notifications.readAt)));
  return row?.n ?? 0;
}

/**
 * Marks the caller's own unread notifications read: the given ids, or all of his when none are
 * given. Ids that are not his are ignored. Refused for a context that only reads on someone's behalf.
 * `upTo`: also every unread notification created at or before that moment (the oldest one a full
 * list showed), so a list cut at LIST_MAX does not leave older unread ones lighting the bell for good.
 */
export async function markAllRead(ctx: Ctx, ids?: string[], opts: { upTo?: Date } = {}): Promise<void> {
  assertOwnContext(ctx);
  if (ids !== undefined && ids.length === 0 && opts.upTo === undefined) return;
  const pick: SQL[] = [];
  if (ids !== undefined) {
    const named = ids.length > 0 ? inArray(s.notifications.id, ids) : undefined;
    const older = opts.upTo ? lte(s.notifications.createdAt, opts.upTo) : undefined;
    const either = named && older ? or(named, older) : (named ?? older);
    if (either) pick.push(either);
  }
  await ctx.db
    .update(s.notifications)
    .set({ readAt: new Date() })
    .where(and(own(ctx), isNull(s.notifications.readAt), ...pick));
}
