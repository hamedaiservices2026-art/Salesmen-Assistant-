"use client";

import { useActionState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Trash2 } from "lucide-react";
import { CURRENCIES } from "@/domain/money";
import { LOCALES, type Locale } from "@/i18n/config";
import { INTL_TAG } from "@/ui/intl-tag";
import {
  addHolidayAction,
  removeHolidayAction,
  updateSettingsAction,
  type HolidayFormState,
  type SettingsFormState,
} from "./actions";

const OWN_NAME = { ar: "العربية", en: "English", ur: "اردو" } as const;
/** Time zones offered for the region; the company's own value is added when it is not among them. */
const TIME_ZONES = [
  "Asia/Riyadh",
  "Asia/Dubai",
  "Asia/Qatar",
  "Asia/Kuwait",
  "Asia/Bahrain",
  "Africa/Cairo",
  "Europe/Istanbul",
  "Asia/Karachi",
  "UTC",
];
/** Weekdays in the order of a Gulf week: Saturday first (0 = Sunday). */
const WEEK_ORDER = [6, 0, 1, 2, 3, 4, 5];
const WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

export type SettingsValues = {
  name: string;
  currency: string;
  timeZone: string;
  sellingWeekdays: number[];
  weekStartsOn: number;
  defaultLocale: Locale;
  behindPct: number;
};
export type HolidayView = { id: string; date: string; name: string | null };

const input =
  "block min-h-11 w-full rounded-lg border border-line bg-white px-3 text-[15px] text-ink focus:border-brand focus:outline-2 focus:outline-brand";
const primaryButton =
  "inline-flex min-h-11 items-center justify-center rounded-[10px] bg-brand px-5 text-[14.5px] font-semibold text-white hover:bg-brand-hover disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";
const secondaryButton =
  "inline-flex min-h-11 items-center justify-center gap-1.5 whitespace-nowrap rounded-[10px] border border-line bg-white px-3.5 text-[14px] font-semibold text-brand hover:bg-brand-tint disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";

export function SettingsForm({ values }: { values: SettingsValues }) {
  const t = useTranslations("admin.settings");
  const tc = useTranslations("currency");
  const [state, action, pending] = useActionState<SettingsFormState, FormData>(updateSettingsAction, {});
  const err = (field: string) => (state.errors?.[field] ? t(`errors.${state.errors[field]}`) : undefined);
  const error = (field: string) =>
    err(field) && (
      <span id={`${field}-error`} role="alert" className="mt-1 block text-[13px] text-alert">
        {err(field)}
      </span>
    );
  const aria = (field: string) => ({
    "aria-invalid": err(field) ? (true as const) : undefined,
    "aria-describedby": err(field) ? `${field}-error` : undefined,
  });
  const zones = TIME_ZONES.includes(values.timeZone) ? TIME_ZONES : [values.timeZone, ...TIME_ZONES];
  const label = "mb-1.5 block text-sm font-medium text-ink-2";

  return (
    <form action={action} className="flex flex-col gap-5 px-5 pb-5">
      {state.saved && (
        <p role="status" className="m-0 rounded-lg bg-brand-tint px-4 py-3 text-[14.5px] text-brand">
          {t("saved")}
        </p>
      )}
      <div className="grid grid-cols-3 items-start gap-4 max-[1100px]:grid-cols-2 max-[700px]:grid-cols-1">
        <label className="block">
          <span className={label}>{t("fields.name")}</span>
          <input name="name" required dir="auto" defaultValue={values.name} className={input} {...aria("name")} />
          {error("name")}
        </label>
        <label className="block">
          <span className={label}>{t("fields.currency")}</span>
          <select name="currency" defaultValue={values.currency} className={input} {...aria("currency")}>
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c} · {tc(c)}
              </option>
            ))}
          </select>
          {error("currency")}
        </label>
        <label className="block">
          <span className={label}>{t("fields.timeZone")}</span>
          <select name="timeZone" defaultValue={values.timeZone} dir="ltr" className={input} {...aria("timeZone")}>
            {zones.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
          {error("timeZone")}
        </label>
        <label className="block">
          <span className={label}>{t("fields.defaultLocale")}</span>
          <select name="defaultLocale" defaultValue={values.defaultLocale} className={input} {...aria("defaultLocale")}>
            {LOCALES.map((code) => (
              <option key={code} value={code} lang={code}>
                {OWN_NAME[code]}
              </option>
            ))}
          </select>
          {error("defaultLocale")}
        </label>
        <label className="block">
          <span className={label}>{t("fields.weekStartsOn")}</span>
          <select name="weekStartsOn" defaultValue={String(values.weekStartsOn)} className={input} {...aria("weekStartsOn")}>
            {WEEK_ORDER.map((d) => (
              <option key={d} value={d}>
                {t(`weekdays.${WEEKDAY_KEYS[d]}`)}
              </option>
            ))}
          </select>
          {error("weekStartsOn")}
        </label>
        <label className="block">
          <span className={label}>{t("fields.behindPct")}</span>
          <div className="flex items-center gap-2">
            <input
              name="behindPct"
              type="number"
              inputMode="numeric"
              min={1}
              max={50}
              step={1}
              required
              dir="ltr"
              defaultValue={values.behindPct}
              className={`${input} tabular-nums`}
              {...aria("behindPct")}
            />
            <span className="text-[15px] text-ink-2">%</span>
          </div>
          {error("behindPct") ?? <span className="mt-1 block text-[13px] text-ink-2">{t("fields.behindPctHint")}</span>}
        </label>
      </div>

      <fieldset className="m-0 min-w-0 border-0 p-0">
        <legend className="mb-1.5 p-0 text-sm font-medium text-ink-2">{t("fields.sellingWeekdays")}</legend>
        <div className="flex flex-wrap gap-2">
          {WEEK_ORDER.map((d) => (
            <label key={d} className="relative">
              <input
                type="checkbox"
                name="weekday"
                value={d}
                defaultChecked={values.sellingWeekdays.includes(d)}
                className="peer absolute inset-0 size-full cursor-pointer opacity-0"
                aria-describedby={err("sellingWeekdays") ? "sellingWeekdays-error" : undefined}
              />
              <span className="inline-flex min-h-11 min-w-24 items-center justify-center rounded-[10px] border border-line bg-white px-3.5 text-[14.5px] font-semibold text-ink-2 peer-checked:border-brand peer-checked:bg-brand-tint peer-checked:text-brand peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand">
                {t(`weekdays.${WEEKDAY_KEYS[d]}`)}
              </span>
            </label>
          ))}
        </div>
        {error("sellingWeekdays") ?? <span className="mt-1.5 block text-[13px] text-ink-2">{t("fields.sellingWeekdaysHint")}</span>}
      </fieldset>

      <div>
        <button type="submit" disabled={pending} className={primaryButton}>
          {t("save")}
        </button>
      </div>
    </form>
  );
}

export function HolidaysCard({ holidays }: { holidays: HolidayView[] }) {
  const t = useTranslations("admin.settings.holidays");
  const locale = useLocale() as Locale;
  const [added, add, adding] = useActionState<HolidayFormState, FormData>(addHolidayAction, {});
  const [removed, remove, removing] = useActionState<HolidayFormState, FormData>(removeHolidayAction, {});
  const date = new Intl.DateTimeFormat(`${INTL_TAG[locale]}-u-nu-latn`, { dateStyle: "full", timeZone: "UTC" });
  const error = added.error ?? removed.error;
  const v = added.values ?? { date: "", name: "" };

  return (
    <div className="flex flex-col gap-4 pb-2">
      <form action={add} className="grid grid-cols-[12rem_1fr_auto] items-end gap-4 px-5 max-[900px]:grid-cols-1">
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-ink-2">{t("date")}</span>
          <input name="date" type="date" required dir="ltr" defaultValue={v.date} className={`${input} tabular-nums`} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-ink-2">{t("name")}</span>
          <input name="name" maxLength={80} defaultValue={v.name} placeholder={t("namePlaceholder")} className={input} />
        </label>
        <button type="submit" disabled={adding} className={primaryButton}>
          {t("add")}
        </button>
      </form>
      {error && (
        <p role="alert" className="m-0 mx-5 rounded-lg bg-alert-tint px-4 py-3 text-[14.5px] text-alert">
          {t(`errors.${error}`)}
        </p>
      )}
      {holidays.length === 0 ? (
        <p className="m-0 border-t border-line-soft px-5 py-6 text-[14.5px] text-ink-2">{t("empty")}</p>
      ) : (
        <ul className="m-0 list-none p-0">
          {holidays.map((h) => (
            <li key={h.id} className="flex items-center justify-between gap-4 border-t border-line-soft px-5 py-2.5">
              <div className="flex min-w-0 flex-col">
                <span className="text-[15px] font-semibold text-ink">{date.format(new Date(`${h.date}T00:00:00Z`))}</span>
                {h.name && <span className="truncate text-[13.5px] text-ink-2">{h.name}</span>}
              </div>
              <form action={remove}>
                <input type="hidden" name="id" value={h.id} />
                <button type="submit" disabled={removing} className={secondaryButton}>
                  <Trash2 size={16} strokeWidth={1.9} aria-hidden="true" />
                  {t("remove")}
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
