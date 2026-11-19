"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { fieldBad, fieldInput, fieldLabel, fieldOk, primaryButton, secondaryButton } from "@/ui/admin/form-styles";
import { saveFocusAction, type FocusFormState } from "./actions";

export type FocusFormItem = {
  id: string;
  name: string;
  nameEn: string;
  nameUr: string;
  sku: string;
  unit: "cases" | "value";
  /** The target as typed in the unit (cases, or riyals). */
  target: string;
  startsOn: string;
  endsOn: string;
  repIds: string[];
  inScheme: boolean;
};

export function FocusForm({
  item,
  defaults,
  reps,
  ym,
}: {
  item: FocusFormItem | null;
  defaults: { startsOn: string; endsOn: string };
  reps: { id: string; name: string }[];
  ym: string;
}) {
  const t = useTranslations("admin.focus");
  const [state, action, pending] = useActionState<FocusFormState, FormData>(saveFocusAction, {});
  const v = state.values ?? {};
  const created = state.saved && !item;
  const [unit, setUnit] = useState<"cases" | "value">((v.unit ?? item?.unit ?? "cases") === "value" ? "value" : "cases");
  const chosen = new Set(state.repIds ?? item?.repIds ?? []);
  const locked = item?.inScheme ?? false;

  const err = (field: string) => (state.errors?.[field] ? t(`errors.${state.errors[field]}`) : undefined);
  const cls = (field: string) => `${fieldInput} ${err(field) ? fieldBad : fieldOk}`;
  const aria = (field: string) => ({
    "aria-invalid": err(field) ? (true as const) : undefined,
    "aria-describedby": err(field) ? `${field}-error` : undefined,
  });
  const error = (field: string) =>
    err(field) && (
      <span id={`${field}-error`} role="alert" className="mt-1 block text-[13px] text-alert">
        {err(field)}
      </span>
    );
  const val = (field: "name" | "nameEn" | "nameUr" | "sku" | "target" | "startsOn" | "endsOn") =>
    v[field] ?? (item ? item[field] : (defaults as Record<string, string>)[field] ?? "");

  return (
    <form key={created ? "created" : "form"} action={action} className="flex flex-col gap-4 px-5 pb-5">
      {state.saved && (
        <p role="status" className="m-0 rounded-lg bg-brand-tint px-4 py-3 text-[14.5px] text-brand">
          {t("saved")}
        </p>
      )}
      {item && <input type="hidden" name="id" value={item.id} />}
      <div className="grid grid-cols-3 items-start gap-4 max-[900px]:grid-cols-1">
        <label className="block">
          <span className={fieldLabel}>{t("fields.name")}</span>
          <input name="name" required lang="ar" dir="rtl" maxLength={80} defaultValue={val("name")} className={cls("name")} {...aria("name")} />
          {error("name")}
        </label>
        <label className="block">
          <span className={fieldLabel}>{t("fields.nameEn")}</span>
          <input name="nameEn" lang="en" dir="ltr" maxLength={80} defaultValue={val("nameEn")} className={cls("nameEn")} {...aria("nameEn")} />
          {error("nameEn")}
        </label>
        <label className="block">
          <span className={fieldLabel}>{t("fields.nameUr")}</span>
          <input name="nameUr" lang="ur" dir="rtl" maxLength={80} defaultValue={val("nameUr")} className={cls("nameUr")} {...aria("nameUr")} />
          {error("nameUr")}
        </label>
      </div>
      <div className="grid grid-cols-3 items-start gap-4 max-[900px]:grid-cols-1">
        <label className="block">
          <span className={fieldLabel}>{t("fields.sku")}</span>
          <input name="sku" dir="ltr" maxLength={40} autoComplete="off" defaultValue={val("sku")} className={cls("sku")} {...aria("sku")} />
          {error("sku")}
        </label>
        <label className="block">
          <span className={fieldLabel}>{t("fields.unit")}</span>
          <select
            name="unit"
            value={unit}
            onChange={(e) => setUnit(e.currentTarget.value === "value" ? "value" : "cases")}
            className={cls("unit")}
            {...aria("unit")}
          >
            <option value="cases">{t("units.cases")}</option>
            <option value="value">{t("units.value")}</option>
          </select>
          {error("unit")}
        </label>
        <label className="block">
          <span className={fieldLabel}>{t("fields.target", { unit: t(`units.${unit}`) })}</span>
          <input
            name="target"
            required
            inputMode={unit === "value" ? "decimal" : "numeric"}
            dir="ltr"
            autoComplete="off"
            defaultValue={val("target")}
            className={`${cls("target")} text-start tabular-nums`}
            {...aria("target")}
          />
          {error("target")}
        </label>
      </div>
      <div className="grid grid-cols-3 items-start gap-4 max-[900px]:grid-cols-1">
        <label className="block">
          <span className={fieldLabel}>{t("fields.startsOn")}</span>
          <input type="date" name="startsOn" required dir="ltr" defaultValue={val("startsOn")} className={`${cls("startsOn")} tabular-nums`} {...aria("startsOn")} />
          {error("startsOn")}
        </label>
        <label className="block">
          <span className={fieldLabel}>{t("fields.endsOn")}</span>
          <input type="date" name="endsOn" required dir="ltr" defaultValue={val("endsOn")} className={`${cls("endsOn")} tabular-nums`} {...aria("endsOn")} />
          {error("endsOn")}
        </label>
      </div>
      {locked && <p className="m-0 text-[13.5px] text-ink-2">{t("lockedHint")}</p>}
      <fieldset className="m-0 min-w-0 border-0 p-0" aria-describedby={err("repIds") ? "repIds-error" : undefined}>
        <legend className={fieldLabel}>{t("fields.reps")}</legend>
        {reps.length === 0 ? (
          <p className="m-0 text-[14px] text-ink-2">{t("noReps")}</p>
        ) : (
          <div className="grid grid-cols-4 gap-2 max-[1100px]:grid-cols-3 max-[700px]:grid-cols-1">
            {reps.map((r) => (
              <label key={r.id} className="flex min-h-11 items-center gap-2.5 rounded-lg border border-line px-3 text-[14.5px] text-ink">
                <input type="checkbox" name="repIds" value={r.id} defaultChecked={chosen.has(r.id)} className="size-5 accent-brand" />
                <bdi>{r.name}</bdi>
              </label>
            ))}
          </div>
        )}
        {error("repIds")}
      </fieldset>
      {error("id")}
      <div className="flex flex-wrap gap-3">
        <button type="submit" disabled={pending} className={primaryButton}>
          {item ? t("form.saveEdit") : t("form.saveNew")}
        </button>
        {item && (
          <Link href={`/admin/focus?ym=${ym}`} className={secondaryButton}>
            {t("form.cancel")}
          </Link>
        )}
      </div>
    </form>
  );
}
