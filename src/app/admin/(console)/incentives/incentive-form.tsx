"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { fieldBad, fieldInput, fieldLabel, fieldOk, primaryButton } from "@/ui/admin/form-styles";
import { createIncentiveAction, type IncentiveFormState } from "./actions";

type Mode = "focus" | "line" | "both";

export function IncentiveForm({
  ym,
  version,
  focus,
  lines,
  currency,
}: {
  ym: string;
  version: number;
  focus: { id: string; name: string; unit: "cases" | "value" }[];
  lines: { id: string; name: string }[];
  currency: string;
}) {
  const t = useTranslations("admin.incentives");
  const tSchemes = useTranslations("admin.schemes");
  const [state, action, pending] = useActionState<IncentiveFormState, FormData>(createIncentiveAction, {});
  const v = state.values ?? {};
  const [mode, setMode] = useState<Mode>((v.mode as Mode | undefined) ?? "focus");
  const [focusId, setFocusId] = useState(v.focusItemId ?? focus[0]?.id ?? "");
  const unit = focus.find((f) => f.id === focusId)?.unit ?? "cases";
  const named = mode !== "line";
  const withLine = mode !== "focus";

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
  const val = (f: string) => v[f] ?? "";
  const pageError = state.error ? t(`pageErrors.${state.error}`) : null;

  return (
    <form key={state.saved ? "saved" : "form"} action={action} className="flex flex-col gap-4 px-5 pb-5">
      {state.saved && (
        <p role="status" className="m-0 rounded-lg bg-brand-tint px-4 py-3 text-[14.5px] text-brand">
          {t("saved", { count: state.saved.notified })}
        </p>
      )}
      {pageError && (
        <p role="alert" className="m-0 rounded-lg bg-alert-tint px-4 py-3 text-[14.5px] text-alert">
          {pageError}
        </p>
      )}
      {state.issues && state.issues.length > 0 && (
        <ul role="alert" className="m-0 flex list-none flex-col gap-1 rounded-lg bg-alert-tint px-4 py-3 text-[14.5px] text-alert">
          {state.issues.map((code) => (
            <li key={code}>{tSchemes.has(`errors.${code}`) ? tSchemes(`errors.${code}`) : tSchemes("errors.shape")}</li>
          ))}
        </ul>
      )}
      <input type="hidden" name="ym" value={ym} />
      <input type="hidden" name="expectedVersion" value={version} />
      <div className="grid grid-cols-3 items-start gap-4 max-[900px]:grid-cols-1">
        <label className="block">
          <span className={fieldLabel}>{t("fields.label")}</span>
          <input name="label" required lang="ar" dir="rtl" maxLength={80} defaultValue={val("label")} className={cls("label")} {...aria("label")} />
          {error("label")}
        </label>
        <label className="block">
          <span className={fieldLabel}>{t("fields.labelEn")}</span>
          <input name="labelEn" lang="en" dir="ltr" maxLength={80} defaultValue={val("labelEn")} className={cls("labelEn")} {...aria("labelEn")} />
          {error("labelEn")}
        </label>
        <label className="block">
          <span className={fieldLabel}>{t("fields.labelUr")}</span>
          <input name="labelUr" lang="ur" dir="rtl" maxLength={80} defaultValue={val("labelUr")} className={cls("labelUr")} {...aria("labelUr")} />
          {error("labelUr")}
        </label>
      </div>
      <div className="grid grid-cols-3 items-start gap-4 max-[900px]:grid-cols-1">
        <label className="block">
          <span className={fieldLabel}>{t("fields.explanation")}</span>
          <textarea name="explanation" required lang="ar" dir="rtl" rows={3} maxLength={500} defaultValue={val("explanation")} className={`${cls("explanation")} py-2`} {...aria("explanation")} />
          {error("explanation")}
        </label>
        <label className="block">
          <span className={fieldLabel}>{t("fields.explanationEn")}</span>
          <textarea name="explanationEn" lang="en" dir="ltr" rows={3} maxLength={500} defaultValue={val("explanationEn")} className={`${cls("explanationEn")} py-2`} {...aria("explanationEn")} />
          {error("explanationEn")}
        </label>
        <label className="block">
          <span className={fieldLabel}>{t("fields.explanationUr")}</span>
          <textarea name="explanationUr" lang="ur" dir="rtl" rows={3} maxLength={500} defaultValue={val("explanationUr")} className={`${cls("explanationUr")} py-2`} {...aria("explanationUr")} />
          {error("explanationUr")}
        </label>
      </div>
      <div className="grid grid-cols-3 items-start gap-4 max-[900px]:grid-cols-1">
        <label className="block">
          <span className={fieldLabel}>{t("fields.amount", { currency })}</span>
          <input name="amount" required inputMode="decimal" dir="ltr" autoComplete="off" defaultValue={val("amount")} className={`${cls("amount")} text-start tabular-nums`} {...aria("amount")} />
          {error("amount")}
        </label>
      </div>
      <fieldset className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0">
        <legend className={fieldLabel}>{t("fields.condition")}</legend>
        <div className="flex flex-wrap gap-2">
          {(["focus", "line", "both"] as const).map((m) => (
            <label key={m} className="flex min-h-11 items-center gap-2.5 rounded-lg border border-line px-3 text-[14.5px] text-ink">
              <input type="radio" name="mode" value={m} checked={mode === m} onChange={() => setMode(m)} className="size-5 accent-brand" />
              {t(`modes.${m}`)}
            </label>
          ))}
        </div>
        <div className="grid grid-cols-3 items-start gap-4 max-[900px]:grid-cols-1">
          {named && (
            <>
              <label className="block">
                <span className={fieldLabel}>{t("fields.focusItem")}</span>
                <select name="focusItemId" value={focusId} onChange={(e) => setFocusId(e.currentTarget.value)} className={cls("focusItemId")} {...aria("focusItemId")}>
                  {focus.length === 0 && <option value="">{t("noFocus")}</option>}
                  {focus.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
                {error("focusItemId")}
              </label>
              <label className="block">
                <span className={fieldLabel}>{t("fields.focusMin", { unit: t(`units.${unit}`) })}</span>
                <input name="focusMin" required inputMode={unit === "value" ? "decimal" : "numeric"} dir="ltr" autoComplete="off" defaultValue={val("focusMin")} className={`${cls("focusMin")} text-start tabular-nums`} {...aria("focusMin")} />
                {error("focusMin")}
              </label>
            </>
          )}
          {withLine && (
            <>
              <label className="block">
                <span className={fieldLabel}>{t("fields.line")}</span>
                <select name="lineId" defaultValue={val("lineId")} className={cls("lineId")} {...aria("lineId")}>
                  {lines.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
                {error("lineId")}
              </label>
              <label className="block">
                <span className={fieldLabel}>{t("fields.minPct")}</span>
                <input name="minPct" required inputMode="numeric" dir="ltr" autoComplete="off" defaultValue={val("minPct")} className={`${cls("minPct")} text-start tabular-nums`} {...aria("minPct")} />
                {error("minPct")}
              </label>
            </>
          )}
        </div>
        <p className="m-0 text-[13.5px] text-ink-2">{mode === "focus" ? t("windowFocus") : t("windowMonth")}</p>
      </fieldset>
      <div className="flex flex-wrap gap-3">
        <button type="submit" disabled={pending} className={primaryButton}>
          {t("submit")}
        </button>
      </div>
    </form>
  );
}
