import { useTranslations } from "next-intl";

export type AiUnavailableReason =
  | "disabled"
  | "company_off"
  | "no_notice"
  | "no_provider"
  | "rate_limited"
  | "quota"
  | "failed"
  | "unreadable"
  | "audio_type"
  | "timeout";

/**
 * One line saying why the smart feature is not usable now and what to do instead. The status region
 * is always mounted (empty while `reason` is null), so a screen reader announces the line when it
 * appears (final review C7).
 */
export function AiUnavailable({ reason, className = "" }: { reason: AiUnavailableReason | null; className?: string }) {
  const t = useTranslations("ai.unavailable");
  return (
    <div role="status" className={reason === null ? "sr-only" : ""}>
      {reason !== null && <p className={`m-0 rounded-xl border border-line bg-brand-tint px-4 py-3 text-[14px] text-ink ${className}`}>{t(reason)}</p>}
    </div>
  );
}
