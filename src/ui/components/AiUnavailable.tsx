import { useTranslations } from "next-intl";

export type AiUnavailableReason =
  | "disabled"
  | "company_off"
  | "no_notice"
  | "no_provider"
  | "rate_limited"
  | "quota"
  | "failed"
  | "unreadable";

/** One line saying why the smart feature is not usable now and what to do instead. */
export function AiUnavailable({ reason, className = "" }: { reason: AiUnavailableReason; className?: string }) {
  const t = useTranslations("ai.unavailable");
  return (
    <p role="status" className={`m-0 rounded-xl border border-line bg-brand-tint px-4 py-3 text-[14px] text-ink ${className}`}>
      {t(reason)}
    </p>
  );
}
