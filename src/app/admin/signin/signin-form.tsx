"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { adminSignInAction, type AdminAuthFormState } from "../actions";
import { ErrorLine, buttonClass, fieldClass } from "@/ui/pin-field";

export function AdminSignInForm() {
  const t = useTranslations("admin.auth");
  const [state, action, pending] = useActionState<AdminAuthFormState, FormData>(adminSignInAction, {});
  return (
    <form action={action} className="space-y-5">
      <label className="block">
        <span className="mb-2 block text-base text-ink-2">{t("signin.email")}</span>
        <input
          name="email"
          type="email"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required
          dir="ltr"
          className={fieldClass}
        />
      </label>
      <label className="block">
        <span className="mb-2 block text-base text-ink-2">{t("signin.password")}</span>
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          maxLength={128}
          required
          dir="ltr"
          className={fieldClass}
        />
      </label>
      <ErrorLine message={state.error ? t(`errors.${state.error}`) : undefined} />
      <button type="submit" disabled={pending} className={buttonClass}>
        {t("signin.submit")}
      </button>
    </form>
  );
}
