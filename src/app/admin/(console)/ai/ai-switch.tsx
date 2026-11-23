"use client";

import { useRef } from "react";
import { useLocale, useTranslations } from "next-intl";
import { primaryButton, secondaryButton } from "@/ui/admin/form-styles";
import { setCompanyAiAction } from "./actions";

/** Turning on goes through a confirm dialog (the scheme editor's pattern); turning off is one press. */
export function AiSwitch({ enabled }: { enabled: boolean }) {
  const t = useTranslations("admin.ai");
  const lead = useLocale() === "ur" ? "leading-[2.2]" : "";
  const dialog = useRef<HTMLDialogElement>(null);
  if (enabled) {
    return (
      <form action={setCompanyAiAction}>
        <input type="hidden" name="enabled" value="0" />
        <button type="submit" className={secondaryButton}>
          {t("turnOff")}
        </button>
      </form>
    );
  }
  return (
    <>
      <button type="button" onClick={() => dialog.current?.showModal()} className={primaryButton}>
        {t("turnOn")}
      </button>
      <dialog
        ref={dialog}
        aria-labelledby="ai-confirm-title"
        className="m-auto w-[min(460px,calc(100vw-32px))] rounded-[14px] border border-line bg-white p-6 text-ink backdrop:bg-ink/40"
      >
        <h2 id="ai-confirm-title" className={`m-0 mb-2 text-[18px] font-bold ${lead}`}>
          {t("confirm.title")}
        </h2>
        <p className={`m-0 text-[15px] ${lead}`}>{t("confirm.body")}</p>
        <form action={setCompanyAiAction} className="mt-5 flex flex-wrap justify-end gap-3">
          <input type="hidden" name="enabled" value="1" />
          <button type="button" onClick={() => dialog.current?.close()} className={secondaryButton}>
            {t("confirm.cancel")}
          </button>
          <button type="submit" className={primaryButton}>
            {t("confirm.confirm")}
          </button>
        </form>
      </dialog>
    </>
  );
}
