import { useTranslations } from "next-intl";
import { readErrorKey } from "@/ui/ai-client";

/**
 * One line saying why the assistant could not answer or listen, and what to do (assistant wording
 * only; R82). The status region is always mounted (empty while `reason` is null), so the line is
 * announced when it appears (final review C7).
 */
export function AssistantUnavailable({ reason, kind = "ask", className = "" }: { reason: string | null; kind?: "ask" | "transcribe"; className?: string }) {
  const t = useTranslations();
  return (
    <div role="status" className={reason === null ? "sr-only" : ""}>
      {reason !== null && <p className={`m-0 rounded-xl border border-line bg-brand-tint px-4 py-3 text-[14px] text-ink ${className}`}>{t(readErrorKey(kind, reason) as never)}</p>}
    </div>
  );
}
