"use client";

import Link from "next/link";
import { Check, CircleCheck, Eraser, TriangleAlert } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { westernDigits } from "@/domain/digits";
import type { Locale } from "@/i18n/config";
import { dayMonth } from "@/ui/intl-tag";

/**
 * Above the form while a draft is being reviewed: what was read, how many fields could not be, a
 * date warning with a link to that day's close, and the button that throws the reading away. The
 * transcript and every other text from the model is shown as plain text inside `<bdi>`, never as HTML,
 * with Western digits (display only: the draft was read from the transcript as heard).
 */
export function DraftBanner({
  source,
  transcript,
  problems,
  reportDate,
  dateMismatch,
  openDayHref,
  onClear,
  cut,
  changesLost,
  dateAcknowledged,
  onAcknowledgeDate,
}: {
  source: "photo" | "voice";
  transcript?: string;
  problems: number;
  reportDate: string | null;
  dateMismatch: boolean;
  /** `/app/close?date=<reportDate>` when the report's date is a past selling day, else null. */
  openDayHref: string | null;
  onClear: () => void;
  /** The voice recording ended early: its last number may be unfinished. */
  cut?: "limit" | "hidden" | "ended";
  /** The page was reloaded and the rep's own changes were not kept. */
  changesLost: boolean;
  /** The rep said the report's date is right (confirm waits for it; R79). */
  dateAcknowledged: boolean;
  onAcknowledgeDate: () => void;
}) {
  const t = useTranslations("close.draft");
  const locale = useLocale() as Locale;
  return (
    <div className="flex flex-col gap-2">
      <div role="status" className="flex flex-col gap-2 rounded-xl bg-brand-tint px-3.5 py-2.5 text-[13.5px] font-medium text-brand">
        <p className="m-0 flex items-start gap-2.5">
          <CircleCheck aria-hidden="true" size={20} strokeWidth={2.2} className="mt-px shrink-0" />
          <span className="text-balance">{source === "voice" ? t("bannerVoice") : t("banner")}</span>
        </p>
        {source === "voice" && transcript && (
          <p className="m-0 ps-[30px] font-normal text-ink">
            <span className="font-semibold">{t("heard")}: </span>
            <bdi dir="auto">{westernDigits(transcript)}</bdi>
          </p>
        )}
        {cut && <p className="m-0 ps-[30px] font-semibold text-ink">{t(cut === "limit" ? "cutLimit" : cut === "hidden" ? "cutHidden" : "cutEnded")}</p>}
        {changesLost && <p className="m-0 ps-[30px] font-semibold text-ink">{t("changesLost")}</p>}
        {problems > 0 && <p className="m-0 ps-[30px] font-semibold text-ink">{t("problems", { n: problems })}</p>}
      </div>
      {dateMismatch && reportDate && (
        <p role="alert" className="m-0 flex flex-col gap-1.5 rounded-xl bg-alert-tint px-3.5 py-2.5 text-[13.5px] font-bold text-alert">
          <span className="flex items-center gap-2">
            <TriangleAlert aria-hidden="true" size={18} strokeWidth={2.2} className="shrink-0" />
            <span>{t("dateMismatch", { date: `\u2068${dayMonth(reportDate, locale)}\u2069` })}</span>
          </span>
          {!dateAcknowledged && (
            <button
              type="button"
              onClick={onAcknowledgeDate}
              className="inline-flex min-h-11 items-center justify-center gap-1.5 self-start rounded-[10px] border border-alert bg-white px-4 text-[15px] font-bold text-alert focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            >
              <Check aria-hidden="true" size={18} strokeWidth={2.2} />
              {t("dateOk")}
            </button>
          )}
          {openDayHref && (
            <Link href={openDayHref} className="inline-flex min-h-11 items-center self-start text-[14px] font-bold text-alert underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
              {t("openThatDay")}
            </Link>
          )}
        </p>
      )}
      <button
        type="button"
        onClick={onClear}
        className="inline-flex min-h-11 items-center justify-center gap-2 self-start rounded-[10px] border border-line bg-white px-4 text-[14px] font-semibold text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        <Eraser aria-hidden="true" size={18} strokeWidth={2} />
        {t("clear")}
      </button>
    </div>
  );
}
