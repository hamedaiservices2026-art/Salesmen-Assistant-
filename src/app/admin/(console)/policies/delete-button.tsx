"use client";

import { useRef } from "react";
import { useTranslations } from "next-intl";
import { primaryButton, secondaryButton } from "@/ui/admin/form-styles";
import { deletePolicyAction } from "./actions";

/** Delete behind a confirm dialog, the same pattern as the scheme editor's publish dialog. */
export function DeletePolicyButton({ id, title }: { id: string; title: string }) {
  const t = useTranslations("admin.policies");
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = `delete-title-${id}`;
  return (
    <>
      <button type="button" onClick={() => dialog.current?.showModal()} className={secondaryButton}>
        {t("delete")}
      </button>
      <dialog
        ref={dialog}
        aria-labelledby={titleId}
        className="m-auto w-[min(460px,calc(100vw-32px))] rounded-[14px] border border-line bg-white p-6 text-ink backdrop:bg-ink/40"
      >
        <h2 id={titleId} className="m-0 mb-2 text-[18px] font-bold">
          {t("confirm.title")}
        </h2>
        <p className="m-0 text-[15px]">
          {t("confirm.body")} <bdi className="font-semibold">{title}</bdi>
        </p>
        <form action={deletePolicyAction} className="mt-5 flex flex-wrap justify-end gap-3">
          <input type="hidden" name="id" value={id} />
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
