"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { acceptInviteAction, type AuthFormState } from "../../(auth-actions)/actions";
import { ErrorLine, PinField, buttonClass } from "@/ui/pin-field";

export function InviteForm({ token }: { token: string }) {
  const t = useTranslations("auth");
  const [state, action, pending] = useActionState<AuthFormState, FormData>(acceptInviteAction, {});
  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="token" value={token} />
      <p className="text-lg text-ink-2">{t("invite.instruction")}</p>
      <PinField name="pin" label={t("invite.pin")} />
      <PinField name="confirm" label={t("invite.confirm")} />
      <ErrorLine message={state.error ? t(`errors.${state.error}`) : undefined} />
      <button type="submit" disabled={pending} className={buttonClass}>
        {t("invite.submit")}
      </button>
    </form>
  );
}
