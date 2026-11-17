"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { CURRENCIES } from "@/domain/money";
import { LOCALES } from "@/i18n/config";
import { InviteLinkPanel } from "@/ui/admin/InviteLinkPanel";
import { createCompanyAction, type NewCompanyFormState } from "./actions";

const TIME_ZONES = ["Asia/Riyadh", "Asia/Dubai", "Asia/Qatar", "Africa/Cairo", "Asia/Karachi"] as const;
const OWN_NAME = { ar: "العربية", en: "English", ur: "اردو" } as const;

const input =
  "block min-h-11 w-full rounded-lg border border-line bg-white px-3 text-[15px] text-ink focus:border-brand focus:outline-2 focus:outline-brand";

export function NewCompanyForm() {
  const t = useTranslations("admin.companies");
  const [state, action, pending] = useActionState<NewCompanyFormState, FormData>(createCompanyAction, {});
  const v = state.values ?? {};
  const err = (field: string) => (state.errors?.[field] ? t(`errors.${state.errors[field]}`) : undefined);

  const field = (name: string, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-ink-2">{label}</span>
      <input
        name={name}
        required
        defaultValue={v[name] ?? ""}
        aria-invalid={err(name) ? true : undefined}
        aria-describedby={err(name) ? `${name}-error` : undefined}
        className={input}
        {...props}
      />
      {err(name) && (
        <span id={`${name}-error`} role="alert" className="mt-1 block text-[13px] text-alert">
          {err(name)}
        </span>
      )}
    </label>
  );

  return (
    <div className="flex flex-col gap-4 px-5 pb-5">
      {state.created && (
        <InviteLinkPanel
          title={t("invite.title", { company: `\u2068${state.created.companyName}\u2069` })}
          body={t("invite.body")}
          path={state.created.invitePath}
          linkLabel={t("invite.linkLabel")}
          copyLabel={t("invite.copy")}
          copiedLabel={t("invite.copied")}
        />
      )}
      <form action={action} className="grid grid-cols-2 gap-4 max-[1100px]:grid-cols-1">
        <div className="col-span-2 max-[1100px]:col-span-1">{field("name", t("new.name"))}</div>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-ink-2">{t("new.currency")}</span>
          <select name="currency" defaultValue={v.currency ?? "SAR"} className={input}>
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-ink-2">{t("new.timeZone")}</span>
          <select name="timeZone" defaultValue={v.timeZone ?? "Asia/Riyadh"} className={input} dir="ltr">
            {TIME_ZONES.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
          {err("timeZone") && (
            <span role="alert" className="mt-1 block text-[13px] text-alert">
              {err("timeZone")}
            </span>
          )}
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-ink-2">{t("new.defaultLocale")}</span>
          <select name="defaultLocale" defaultValue={v.defaultLocale ?? "ar"} className={input}>
            {LOCALES.map((code) => (
              <option key={code} value={code} lang={code}>
                {OWN_NAME[code]}
              </option>
            ))}
          </select>
        </label>
        {field("adminName", t("new.adminName"))}
        <div className="col-span-2 max-[1100px]:col-span-1">
          {field("adminEmail", t("new.adminEmail"), { type: "email", dir: "ltr", autoComplete: "off", autoCapitalize: "none", spellCheck: false })}
        </div>
        <div className="col-span-2 max-[1100px]:col-span-1">
          <button
            type="submit"
            disabled={pending}
            className="inline-flex min-h-11 items-center justify-center rounded-[10px] bg-brand px-5 text-[14.5px] font-semibold text-white hover:bg-brand-hover disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            {t("new.submit")}
          </button>
        </div>
      </form>
    </div>
  );
}
