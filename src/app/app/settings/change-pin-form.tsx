"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { ErrorLine, PinField, buttonClass } from "@/ui/pin-field";
import { changePinAction, type ChangePinState } from "./actions";

/** Current PIN, new PIN twice. Uncontrolled fields: React clears them after every submit, so a PIN is never shown again. */
export function ChangePinForm() {
  const t = useTranslations("settings.pin");
  const [state, action, pending] = useActionState<ChangePinState, FormData>(changePinAction, {});
  return (
    <form action={action} className="flex flex-col gap-4">
      <PinField name="currentPin" label={t("current")} autoComplete="current-password" />
      <PinField name="newPin" label={t("new")} autoComplete="new-password" />
      <PinField name="confirm" label={t("confirm")} autoComplete="new-password" />
      <ErrorLine message={state.error ? t(`errors.${state.error}`) : undefined} />
      {state.status === "done" && (
        <p role="status" className="m-0 rounded-lg bg-brand-tint px-4 py-3 text-base font-medium text-brand">
          {t("done")}
        </p>
      )}
      <button type="submit" disabled={pending} className={buttonClass}>
        {t("submit")}
      </button>
      <p className="m-0 text-[13px] text-ink-2">{t("forgot")}</p>
    </form>
  );
}
