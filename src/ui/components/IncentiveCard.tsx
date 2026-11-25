"use client";

import { Gift } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { ReadAloud } from "./ReadAloud";

/** A recent incentive notice: its title and body as the company wrote them (text only), "explain simply" and read-aloud. */
export function IncentiveCard({
  title,
  body,
  when,
  onExplain,
  explainDisabled = false,
}: {
  title: string;
  body: string;
  when: string;
  onExplain: () => void;
  explainDisabled?: boolean;
}) {
  const t = useTranslations("assistant");
  const lead = useLocale() === "ur" ? "leading-[2.2]" : "leading-relaxed";
  return (
    <section aria-label={t("incentiveTitle")} className="flex flex-col gap-2.5 rounded-[14px] bg-brand-tint px-4 py-3.5">
      <div className="flex items-center gap-2.5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-brand text-white">
          <Gift aria-hidden="true" size={20} strokeWidth={1.8} />
        </span>
        <div className="flex min-w-0 flex-col">
          <h2 className="m-0 text-[15px] font-bold">
            <bdi>{title}</bdi>
          </h2>
          <span className="text-[13px] text-ink-2">{when}</span>
        </div>
      </div>
      <p className={`m-0 whitespace-pre-line text-[14.5px] text-ink ${lead}`}>{body}</p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={explainDisabled}
          onClick={onExplain}
          className="min-h-11 min-w-40 flex-1 rounded-[10px] border-0 bg-brand px-3 text-[14px] font-semibold text-white hover:bg-brand-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-60"
        >
          {t("explain")}
        </button>
        <ReadAloud text={`${title}. ${body}`} hintClassName="basis-full" />
      </div>
    </section>
  );
}
