"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { signInAction, type AuthFormState } from "../(auth-actions)/actions";
import { ErrorLine, PinField, buttonClass, fieldClass } from "@/ui/pin-field";

export function SignInForm({ defaultLogin = "" }: { defaultLogin?: string }) {
  const t = useTranslations("auth");
  const [state, action, pending] = useActionState<AuthFormState, FormData>(signInAction, {});
  return (
    <form action={action} className="space-y-5">
      <label className="block">
        <span className="mb-2 block text-base text-ink-2">{t("signin.login")}</span>
        <input
          name="login"
          defaultValue={defaultLogin}
          type="text"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required
          dir="ltr"
          className={fieldClass}
        />
      </label>
      <PinField name="pin" label={t("signin.pin")} />
      <ErrorLine message={state.error ? t(`errors.${state.error}`) : undefined} />
      <button type="submit" disabled={pending} className={buttonClass}>
        {t("signin.submit")}
      </button>
    </form>
  );
}
