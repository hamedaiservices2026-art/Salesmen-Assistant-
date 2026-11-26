"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { clearConversationAction } from "./actions";

const BTN =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-[14px] font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-60";

/** Deletes the rep's whole assistant conversation after one confirm; says how long conversations are kept. */
export function ClearConversation({ label, showRetention = false, onCleared }: { label: string; showRetention?: boolean; onCleared?: () => void }) {
  const t = useTranslations("assistant");
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState(false);
  const [failed, setFailed] = useState(false);
  const [busy, startTransition] = useTransition();
  const noEl = useRef<HTMLButtonElement>(null);
  const clearEl = useRef<HTMLButtonElement>(null);
  // Focus (final review C5): "No" when the confirm opens; back on the clear button when it closes.
  const wasConfirming = useRef(false);
  useEffect(() => {
    if (confirming) noEl.current?.focus();
    else if (wasConfirming.current) clearEl.current?.focus();
    wasConfirming.current = confirming;
  }, [confirming]);

  function clear() {
    startTransition(async () => {
      try {
        await clearConversationAction();
      } catch {
        // The conversation is still there: the confirm stays open and says so.
        setFailed(true);
        return;
      }
      setFailed(false);
      setConfirming(false);
      setDone(true);
      onCleared?.();
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-2">
      {confirming ? (
        <div role="alertdialog" aria-label={t("clearConfirm")} className="flex flex-col gap-2.5 rounded-xl border border-line bg-white p-3.5">
          <p className="m-0 text-[14.5px] font-semibold text-ink">{t("clearConfirm")}</p>
          <div className="flex gap-2">
            <button type="button" disabled={busy} onClick={clear} className={`${BTN} flex-1 border border-alert bg-alert-tint text-alert`}>
              {t("clearYes")}
            </button>
            <button
              ref={noEl}
              type="button"
              disabled={busy}
              onClick={() => {
                setFailed(false);
                setConfirming(false);
              }}
              className={`${BTN} flex-1 border border-line bg-white text-ink`}
            >
              {t("clearNo")}
            </button>
          </div>
          {failed && (
            <p role="alert" className="m-0 rounded-xl bg-alert-tint px-3.5 py-2.5 text-[13.5px] font-semibold text-alert">
              {t("clearFailed")}
            </p>
          )}
        </div>
      ) : (
        <button
          ref={clearEl}
          type="button"
          onClick={() => {
            setDone(false);
            setConfirming(true);
          }}
          className={`${BTN} self-start border border-line bg-white text-ink hover:bg-brand-tint`}
        >
          <Trash2 aria-hidden="true" size={18} strokeWidth={1.9} />
          {label}
        </button>
      )}
      <p role="status" className="m-0 text-[13px] text-ink-2">
        {done ? t("cleared") : showRetention ? t("retention") : ""}
      </p>
    </div>
  );
}
