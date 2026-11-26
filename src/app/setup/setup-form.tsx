"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { InviteLinkPanel } from "@/ui/admin/InviteLinkPanel";
import { ErrorLine, buttonClass, fieldClass } from "@/ui/pin-field";
import { createFirstOwner, type SetupFormState } from "./actions";

function Field({
  name,
  label,
  type = "text",
  autoComplete,
  maxLength,
  defaultValue,
  dir,
}: {
  name: string;
  label: string;
  type?: "text" | "email" | "password";
  autoComplete: string;
  maxLength: number;
  defaultValue?: string;
  dir?: "ltr" | "auto";
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-base text-ink-2">{label}</span>
      <input
        name={name}
        type={type}
        autoComplete={autoComplete}
        autoCapitalize={name === "name" ? "words" : "none"}
        autoCorrect="off"
        spellCheck={false}
        maxLength={maxLength}
        defaultValue={defaultValue}
        required
        dir={dir}
        className={fieldClass}
      />
    </label>
  );
}

export function SetupForm() {
  const t = useTranslations("setup");
  const [state, action, pending] = useActionState<SetupFormState, FormData>(createFirstOwner, {});
  if (state.invitePath) {
    return (
      <div className="space-y-5">
        <InviteLinkPanel
          title={t("done.title")}
          body={t("done.body")}
          path={state.invitePath}
          linkLabel={t("done.link")}
          copyLabel={t("done.copy")}
          copiedLabel={t("done.copied")}
        />
        <p className="m-0 text-base text-ink-2">{t("done.next")}</p>
      </div>
    );
  }
  return (
    <form action={action} className="space-y-5">
      <p className="m-0 text-lg text-ink-2">{t("instruction")}</p>
      <Field name="token" label={t("token")} type="password" autoComplete="off" maxLength={512} dir="ltr" />
      <Field
        name="email"
        label={t("email")}
        type="email"
        autoComplete="email"
        maxLength={254}
        defaultValue={state.values?.email}
        dir="ltr"
      />
      <Field name="name" label={t("name")} autoComplete="name" maxLength={100} defaultValue={state.values?.name} dir="auto" />
      <ErrorLine message={state.error ? t(`errors.${state.error}`) : undefined} />
      <button type="submit" disabled={pending} className={buttonClass}>
        {t("submit")}
      </button>
    </form>
  );
}
