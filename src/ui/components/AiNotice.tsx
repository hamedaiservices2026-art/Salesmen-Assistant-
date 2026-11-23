"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { acceptAiNoticeAction, withdrawAiNoticeAction } from "@/app/app/ai-notice-actions";

const BTN =
  "flex min-h-[52px] w-full items-center justify-center rounded-xl text-base font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";

/** The one-time notice as a bottom sheet. Accepting records consent for the signed-in rep only. */
export function AiNoticeSheet({ open, onClose, version }: { open: boolean; onClose: () => void; version: number }) {
  const t = useTranslations("ai.notice");
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  async function accept(form: FormData) {
    await acceptAiNoticeAction(form);
    onClose();
  }
  return (
    <dialog
      ref={dialog}
      aria-labelledby="ai-notice-title"
      onClose={onClose}
      className="m-0 mt-auto max-h-[90dvh] w-full max-w-none overflow-y-auto rounded-t-[20px] border border-line bg-white p-5 text-ink backdrop:bg-ink/40"
    >
      <h2 id="ai-notice-title" className="m-0 mb-3 text-[18px] font-bold">
        {t("title")}
      </h2>
      <ul className="m-0 mb-5 flex list-none flex-col gap-3 p-0 text-[15px] leading-loose">
        {(["p1", "p2", "p3", "p4", "p5"] as const).map((k) => (
          <li key={k}>{t(k)}</li>
        ))}
      </ul>
      <form action={accept} className="flex flex-col gap-2.5">
        <input type="hidden" name="version" value={version} />
        <button type="submit" className={`${BTN} border-0 bg-brand text-white hover:bg-brand-hover`}>
          {t("accept")}
        </button>
        <button type="button" onClick={onClose} className={`${BTN} border border-line bg-white text-ink hover:bg-brand-tint`}>
          {t("decline")}
        </button>
      </form>
    </dialog>
  );
}

/** The settings row: whether the notice is accepted, a button to read it, and one to withdraw. */
export function AiNotice({ accepted, version }: { accepted: boolean; version: number }) {
  const t = useTranslations("settings.ai");
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-2.5">
      <p className="m-0 text-[15px] text-ink-2">{accepted ? t("accepted") : t("notAccepted")}</p>
      <button type="button" onClick={() => setOpen(true)} className={`${BTN} border border-line bg-white text-ink hover:bg-brand-tint`}>
        {t("read")}
      </button>
      {accepted && (
        <form action={withdrawAiNoticeAction}>
          <button type="submit" className={`${BTN} border border-line bg-white text-ink hover:bg-brand-tint`}>
            {t("withdraw")}
          </button>
        </form>
      )}
      <AiNoticeSheet open={open} onClose={() => setOpen(false)} version={version} />
    </div>
  );
}
