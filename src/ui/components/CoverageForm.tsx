"use client";

import { useActionState, useId, useState } from "react";
import { Check } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import type { Locale } from "@/i18n/config";
import type { CoverageState } from "@/server/repos/coverage-form";
import { INTL_TAG } from "@/ui/intl-tag";

const fieldClass =
  "box-border block h-12 w-full rounded-[10px] border bg-white px-3 text-[17px] font-bold text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";

/**
 * One coverage line of one rep: customers covered, customers in the territory, and the date they
 * are as of (one of the last days, so digits stay Western). The server action decides who may save
 * for `repId`; this form only carries it.
 */
export function CoverageForm({
  action,
  repId,
  lineId,
  lineName,
  initialCovered,
  initialTotal,
  days,
}: {
  action: (prev: CoverageState, data: FormData) => Promise<CoverageState>;
  repId: string;
  lineId: string;
  lineName: string;
  initialCovered: string;
  initialTotal: string;
  /** ISO dates, newest (today) first. */
  days: string[];
}) {
  const t = useTranslations("coverage");
  const locale = useLocale() as Locale;
  const [state, formAction, pending] = useActionState<CoverageState, FormData>(action, { errors: {} });
  const base = useId();
  // Controlled, so a refused save keeps what was typed (a form action resets uncontrolled fields).
  const [values, setValues] = useState({ covered: initialCovered, total: initialTotal, asOf: days[0] ?? "" });
  const dateFmt = new Intl.DateTimeFormat(`${INTL_TAG[locale] ?? "ar-EG"}-u-nu-latn`, {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
  const err = (name: string) => (state.errors[name] ? t(`errors.${state.errors[name]}`) : undefined);
  const general = err("repId") ?? err("lineId");

  const field = (name: "covered" | "total", label: string) => {
    const e = err(name);
    return (
      <div className="min-w-0 flex-1">
        <label htmlFor={`${base}-${name}`} className="mb-1 block text-[13px] font-medium text-ink-2">
          {label}
        </label>
        <input
          id={`${base}-${name}`}
          name={name}
          type="text"
          inputMode="numeric"
          dir="ltr"
          autoComplete="off"
          value={values[name]}
          onChange={(e) => setValues((v) => ({ ...v, [name]: e.target.value }))}
          aria-invalid={e ? true : undefined}
          aria-describedby={e ? `${base}-${name}-error` : undefined}
          className={`${fieldClass} text-start ${e ? "border-alert" : "border-line"}`}
        />
        {e && (
          <p id={`${base}-${name}-error`} className="m-0 mt-1 text-[13px] font-semibold text-alert">
            {e}
          </p>
        )}
      </div>
    );
  };

  const dateError = err("asOf");
  return (
    <form action={formAction} aria-label={lineName} className="flex flex-col gap-3">
      <input type="hidden" name="repId" value={repId} />
      <input type="hidden" name="lineId" value={lineId} />
      <div className="flex gap-3">
        {field("covered", t("form.covered"))}
        {field("total", t("form.total"))}
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[180px] flex-1">
          <label htmlFor={`${base}-asOf`} className="mb-1 block text-[13px] font-medium text-ink-2">
            {t("form.asOf")}
          </label>
          <select
            id={`${base}-asOf`}
            name="asOf"
            value={values.asOf}
            onChange={(e) => setValues((v) => ({ ...v, asOf: e.target.value }))}
            aria-invalid={dateError ? true : undefined}
            aria-describedby={dateError ? `${base}-asOf-error` : undefined}
            className={`${fieldClass} text-[15px] font-medium ${dateError ? "border-alert" : "border-line"}`}
          >
            {days.map((d) => (
              <option key={d} value={d}>
                {dateFmt.format(new Date(`${d}T00:00:00Z`))}
              </option>
            ))}
          </select>
          {dateError && (
            <p id={`${base}-asOf-error`} className="m-0 mt-1 text-[13px] font-semibold text-alert">
              {dateError}
            </p>
          )}
        </div>
        <button
          type="submit"
          disabled={pending}
          className="inline-flex min-h-12 min-w-[140px] items-center justify-center gap-2 rounded-[10px] border-0 bg-brand px-5 text-[15px] font-bold text-white hover:bg-brand-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:opacity-60"
        >
          <Check aria-hidden="true" size={20} strokeWidth={2} />
          {t("form.save")}
        </button>
      </div>
      {general && (
        <p role="alert" className="m-0 text-[13px] font-semibold text-alert">
          {general}
        </p>
      )}
      {state.saved === lineId && Object.keys(state.errors).length === 0 && (
        <p role="status" className="m-0 text-[13px] font-semibold text-brand">
          {t("form.saved")}
        </p>
      )}
    </form>
  );
}
