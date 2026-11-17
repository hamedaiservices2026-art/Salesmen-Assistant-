"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { acceptAdminInviteAction, type AdminAuthFormState } from "../../actions";
import { ErrorLine, buttonClass, fieldClass } from "@/ui/pin-field";

function PasswordField({ name, label }: { name: string; label: string }) {
  return (
    <label className="block">
      <span className="mb-2 block text-base text-ink-2">{label}</span>
      <input
        name={name}
        type="password"
        autoComplete="new-password"
        minLength={10}
        maxLength={128}
        required
        dir="ltr"
        className={fieldClass}
      />
    </label>
  );
}

export function AdminInviteForm({ token, email }: { token: string; email: string }) {
  const t = useTranslations("admin.auth");
  const [state, action, pending] = useActionState<AdminAuthFormState, FormData>(acceptAdminInviteAction, {});
  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="token" value={token} />
      {/* Lets a password manager store the new password against the right email. */}
      <input type="hidden" name="email" value={email} autoComplete="username" />
      <p className="text-lg text-ink-2">{t("invite.instruction")}</p>
      <PasswordField name="password" label={t("invite.password")} />
      <PasswordField name="confirm" label={t("invite.confirm")} />
      <ErrorLine message={state.error ? t(`errors.${state.error}`) : undefined} />
      <button type="submit" disabled={pending} className={buttonClass}>
        {t("invite.submit")}
      </button>
    </form>
  );
}
