"use client";

import { useActionState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { LOCALES, type Locale } from "@/i18n/config";
import { INTL_TAG } from "@/ui/intl-tag";
import { InviteLinkPanel } from "@/ui/admin/InviteLinkPanel";
import {
  assignSupervisorAction,
  createUserAction,
  issueInviteAction,
  setActiveAction,
  type CreateUserState,
  type RowActionState,
} from "./actions";

const OWN_NAME = { ar: "العربية", en: "English", ur: "اردو" } as const;
const ROLES = ["rep", "supervisor", "admin"] as const;

export type UserRowView = {
  id: string;
  name: string;
  login: string;
  role: "rep" | "supervisor" | "admin" | "owner";
  active: boolean;
  supervisorId: string | null;
  supervisorName: string | null;
  hasSecret: boolean;
  lastClose: string | null;
};
export type SupervisorOption = { id: string; name: string };

const input =
  "block min-h-11 w-full rounded-lg border border-line bg-white px-3 text-[15px] text-ink focus:border-brand focus:outline-2 focus:outline-brand";
const secondaryButton =
  "inline-flex min-h-11 items-center justify-center whitespace-nowrap rounded-[10px] border border-line bg-white px-3.5 text-[14px] font-semibold text-brand hover:bg-brand-tint disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";
const isolate = (name: string) => `⁨${name}⁩`;

export function CreateUserForm({ supervisors, defaultLocale }: { supervisors: SupervisorOption[]; defaultLocale: Locale }) {
  const t = useTranslations("admin.users");
  const [state, action, pending] = useActionState<CreateUserState, FormData>(createUserAction, {});
  const v = state.values ?? {};
  const err = (field: string) => (state.errors?.[field] ? t(`errors.${state.errors[field]}`) : undefined);

  const error = (name: string) =>
    err(name) && (
      <span id={`${name}-error`} role="alert" className="mt-1 block text-[13px] text-alert">
        {err(name)}
      </span>
    );

  return (
    <div className="flex flex-col gap-4 px-5 pb-5">
      {state.created && (
        <InviteLinkPanel
          title={t("invite.createdTitle", { name: isolate(state.created.name) })}
          body={t("invite.createdBody")}
          path={state.created.invitePath}
          linkLabel={t("invite.linkLabel")}
          copyLabel={t("invite.copy")}
          copiedLabel={t("invite.copied")}
        />
      )}
      <form action={action} className="grid grid-cols-3 items-start gap-4 max-[1100px]:grid-cols-2 max-[700px]:grid-cols-1">
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-ink-2">{t("new.name")}</span>
          <input
            name="name"
            required
            defaultValue={v.name ?? ""}
            aria-invalid={err("name") ? true : undefined}
            aria-describedby={err("name") ? "name-error" : undefined}
            className={input}
          />
          {error("name")}
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-ink-2">{t("new.login")}</span>
          <input
            name="login"
            required
            dir="ltr"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            defaultValue={v.login ?? ""}
            aria-invalid={err("login") ? true : undefined}
            aria-describedby={err("login") ? "login-error" : "login-hint"}
            className={input}
          />
          {error("login") ?? (
            <span id="login-hint" className="mt-1 block text-[13px] text-ink-2">
              {t("new.loginHint")}
            </span>
          )}
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-ink-2">{t("new.role")}</span>
          <select name="role" defaultValue={v.role ?? "rep"} className={input}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {t(`roles.${r}`)}
              </option>
            ))}
          </select>
          {error("role")}
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-ink-2">{t("new.supervisor")}</span>
          <select name="supervisorId" defaultValue={v.supervisorId ?? ""} className={input}>
            <option value="">{t("noSupervisor")}</option>
            {supervisors.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          {error("supervisorId")}
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-ink-2">{t("new.locale")}</span>
          <select name="locale" defaultValue={v.locale ?? defaultLocale} className={input}>
            {LOCALES.map((code) => (
              <option key={code} value={code} lang={code}>
                {OWN_NAME[code]}
              </option>
            ))}
          </select>
          {error("locale")}
        </label>
        <div className="flex items-end self-end">
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

function RowForm({
  action,
  userId,
  label,
  extra,
  disabled,
}: {
  action: (form: FormData) => void;
  userId: string;
  label: string;
  extra?: Record<string, string>;
  disabled?: boolean;
}) {
  return (
    <form action={action}>
      <input type="hidden" name="userId" value={userId} />
      {Object.entries(extra ?? {}).map(([k, val]) => (
        <input key={k} type="hidden" name={k} value={val} />
      ))}
      <button type="submit" disabled={disabled} className={secondaryButton}>
        {label}
      </button>
    </form>
  );
}

export function UserTable({ rows, supervisors }: { rows: UserRowView[]; supervisors: SupervisorOption[] }) {
  const t = useTranslations("admin.users");
  const locale = useLocale() as Locale;
  const [issued, issue, issuing] = useActionState<RowActionState, FormData>(issueInviteAction, {});
  const [toggled, toggle, toggling] = useActionState<RowActionState, FormData>(setActiveAction, {});
  const [assigned, assign] = useActionState<RowActionState, FormData>(assignSupervisorAction, {});

  const date = new Intl.DateTimeFormat(`${INTL_TAG[locale]}-u-nu-latn`, { dateStyle: "medium", timeZone: "UTC" });
  const linkUser = issued.link ? rows.find((r) => r.id === issued.link!.userId) : undefined;
  const error = issued.error ?? toggled.error ?? assigned.error;
  const th = "px-4 py-2.5 text-start text-[13px] font-semibold text-ink-2";

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <p role="alert" className="m-0 rounded-lg bg-alert-tint px-4 py-3 text-[14.5px] text-alert">
          {t(`errors.row_${error}`)}
        </p>
      )}
      {issued.link && linkUser && (
        <div className="px-5">
          <InviteLinkPanel
            title={t("invite.resetTitle", { name: isolate(linkUser.name) })}
            body={t("invite.resetBody", { kind: linkUser.role === "admin" ? "password" : "pin" })}
            path={issued.link.invitePath}
            linkLabel={t("invite.linkLabel")}
            copyLabel={t("invite.copy")}
            copiedLabel={t("invite.copied")}
          />
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[14.5px]">
          <thead>
            <tr className="bg-canvas">
              <th scope="col" className={th}>{t("cols.name")}</th>
              <th scope="col" className={th}>{t("cols.login")}</th>
              <th scope="col" className={th}>{t("cols.role")}</th>
              <th scope="col" className={th}>{t("cols.supervisor")}</th>
              <th scope="col" className={th}>{t("cols.status")}</th>
              <th scope="col" className={th}>{t("cols.lastClose")}</th>
              <th scope="col" className={th}>
                <span className="sr-only">{t("cols.actions")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.id} className="border-t border-line-soft align-middle">
                <th scope="row" className="px-4 py-2.5 text-start font-semibold text-ink">
                  <bdi>{u.name}</bdi>
                </th>
                <td className="px-4 py-2.5 text-ink-2" dir="ltr">
                  <span className="block text-start">{u.login}</span>
                </td>
                <td className="px-4 py-2.5">{t(`roles.${u.role}`)}</td>
                <td className="px-4 py-2.5">
                  {u.role === "rep" ? (
                    <form action={assign}>
                      <input type="hidden" name="repId" value={u.id} />
                      <select
                        key={u.supervisorId ?? "none"}
                        name="supervisorId"
                        aria-label={t("supervisorFor", { name: isolate(u.name) })}
                        defaultValue={u.supervisorId ?? ""}
                        onChange={(e) => e.currentTarget.form?.requestSubmit()}
                        className={`${input} min-w-[8.5rem]`}
                      >
                        <option value="">{t("noSupervisor")}</option>
                        {supervisors.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                        {u.supervisorId && !supervisors.some((s) => s.id === u.supervisorId) && (
                          <option value={u.supervisorId}>{u.supervisorName}</option>
                        )}
                      </select>
                    </form>
                  ) : (
                    <span className="text-muted">{t("noValue")}</span>
                  )}
                </td>
                <td className="px-4 py-2.5">
                  <span
                    className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-1 text-[13px] font-semibold ${
                      !u.active ? "border border-line bg-white text-ink-2" : u.hasSecret ? "bg-brand-tint text-brand" : "bg-canvas text-ink-2"
                    }`}
                  >
                    {!u.active ? t("status.inactive") : u.hasSecret ? t("status.active") : t("status.invited")}
                  </span>
                </td>
                <td className="px-4 py-2.5 tabular-nums text-ink-2">
                  {u.lastClose ? date.format(new Date(`${u.lastClose}T00:00:00Z`)) : t("noValue")}
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex flex-wrap justify-end gap-2">
                    {u.active && <RowForm action={issue} userId={u.id} label={t("actions.newLink")} disabled={issuing} />}
                    <RowForm
                      action={toggle}
                      userId={u.id}
                      extra={{ active: String(!u.active) }}
                      label={u.active ? t("actions.deactivate") : t("actions.activate")}
                      disabled={toggling}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
