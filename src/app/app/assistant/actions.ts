"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { isNotificationId } from "@/domain/assistant/explain";
import { requireCtx } from "@/server/auth/guard";
import { ask } from "@/server/assistant/ask";
import { clearConversation } from "@/server/assistant/conversation";
import type { ChatReply } from "@/ui/chat-state";

// `after()` is not called here yet: Task 20 adds the maintenance run to `askAction` (R38).

/**
 * One question to the assistant, for the signed-in rep only (the session decides who; nothing about
 * the caller comes from the browser). Fact labels are written in the rep's language from the
 * catalog. The result is exactly what the server approved: an answer with its citations, or a
 * verdict with the facts the server chose, or a refusal reason. An unexpected error is `failed`,
 * with nothing of it returned.
 */
export async function askAction(question: string, explain?: string): Promise<ChatReply> {
  const ctx = await requireCtx();
  if (typeof question !== "string") return { ok: false, reason: "empty" };
  if (explain !== undefined && !isNotificationId(explain)) return { ok: false, reason: "failed" };
  try {
    const tr = await getTranslations({ locale: ctx.locale });
    const t = (key: string, values?: Record<string, string | number>) => tr(key as never, values as never);
    const r = await ask(ctx, { question, ...(explain ? { explain: { notificationId: explain } } : {}) }, { t });
    if (!r.ok) return { ok: false, reason: r.reason };
    if (r.verdict === "answer") return { ok: true, verdict: "answer", text: r.text, citations: r.citations.map((c) => ({ title: c.title, label: c.label })) };
    return { ok: true, verdict: r.verdict, facts: r.facts.map((f) => ({ id: f.id, label: f.label, value: f.value })) };
  } catch (e) {
    console.error("assistant ask failed", e instanceof Error ? e.name : "unknown error");
    return { ok: false, reason: "failed" };
  }
}

/** Deletes the signed-in rep's own conversation. */
export async function clearConversationAction(): Promise<{ deleted: number }> {
  const ctx = await requireCtx();
  const r = await clearConversation(ctx);
  revalidatePath("/app/assistant");
  return r;
}
