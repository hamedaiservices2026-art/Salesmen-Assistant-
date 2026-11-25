import { useTranslations } from "next-intl";
import { readErrorKey } from "@/ui/ai-client";

/** One line saying why the assistant could not answer or listen, and what to do (assistant wording only; R82). */
export function AssistantUnavailable({ reason, kind = "ask", className = "" }: { reason: string; kind?: "ask" | "transcribe"; className?: string }) {
  const t = useTranslations();
  return (
    <p role="status" className={`m-0 rounded-xl border border-line bg-brand-tint px-4 py-3 text-[14px] text-ink ${className}`}>
      {t(readErrorKey(kind, reason) as never)}
    </p>
  );
}
