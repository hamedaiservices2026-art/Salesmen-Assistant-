"use client";

import { useTranslations } from "next-intl";
import { Plus, Trash2 } from "lucide-react";
import type { TierRow } from "./scheme-form";
import { fieldBad, fieldInput, fieldLabel, fieldOk, iconButton, secondaryButton, type FieldState } from "./form-styles";

/**
 * The tiers of one card: from what achievement percent, and what it pays (a fixed amount, or, only
 * on a line counted in money, a percent of sales).
 */
export function TierRows({
  idBase,
  tiers,
  allowPct,
  currencyLabel,
  state,
  onChange,
}: {
  idBase: string;
  tiers: TierRow[];
  allowPct: boolean;
  currencyLabel: string;
  state: FieldState;
  onChange: (tiers: TierRow[]) => void;
}) {
  const t = useTranslations("admin.schemes.card.tiers");
  const tf = useTranslations("admin.schemes.fieldErrors");
  const set = (i: number, patch: Partial<TierRow>) => onChange(tiers.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const box = (field: string) => (state(field).invalid ? fieldBad : fieldOk);
  const msg = (field: string) => {
    const m = state(field).message;
    return m ? <span className="mt-1 block text-[12.5px] text-alert">{tf(m as "required" | "invalid")}</span> : null;
  };

  return (
    <fieldset className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0">
      <legend className="mb-1 p-0 text-[14.5px] font-bold text-ink">{t("title")}</legend>
      <p className="m-0 text-[13px] text-ink-2">{t("hint")}</p>
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {tiers.map((row, i) => {
          const pctKind = row.payKind === "pct";
          return (
            <li key={i} className="flex flex-wrap items-start gap-3 rounded-xl bg-canvas p-3">
              <div className="w-28 shrink-0">
                <label className={fieldLabel} htmlFor={`${idBase}-tier-${i}-from`}>
                  {t("from")}
                </label>
                <input
                  id={`${idBase}-tier-${i}-from`}
                  value={row.minPct}
                  onChange={(e) => set(i, { minPct: e.target.value })}
                  inputMode="numeric"
                  autoComplete="off"
                  dir="ltr"
                  aria-invalid={state(`tiers.${i}.minPct`).invalid || undefined}
                  className={`${fieldInput} text-end tabular-nums ${box(`tiers.${i}.minPct`)}`}
                />
                {msg(`tiers.${i}.minPct`)}
              </div>
              {allowPct && (
                <div className="w-44 shrink-0">
                  <label className={fieldLabel} htmlFor={`${idBase}-tier-${i}-kind`}>
                    {t("payKind")}
                  </label>
                  <select
                    id={`${idBase}-tier-${i}-kind`}
                    value={row.payKind}
                    onChange={(e) => set(i, { payKind: e.target.value as TierRow["payKind"], pay: "" })}
                    className={`${fieldInput} ${fieldOk}`}
                  >
                    <option value="fixed">{t("fixed")}</option>
                    <option value="pct">{t("pct")}</option>
                  </select>
                </div>
              )}
              <div className="min-w-32 flex-1">
                <label className={fieldLabel} htmlFor={`${idBase}-tier-${i}-pay`}>
                  {pctKind ? t("percent") : t("amount", { currency: currencyLabel })}
                </label>
                <input
                  id={`${idBase}-tier-${i}-pay`}
                  value={row.pay}
                  onChange={(e) => set(i, { pay: e.target.value })}
                  inputMode="decimal"
                  autoComplete="off"
                  dir="ltr"
                  aria-invalid={state(`tiers.${i}.pay`).invalid || undefined}
                  className={`${fieldInput} text-end tabular-nums ${box(`tiers.${i}.pay`)}`}
                />
                {msg(`tiers.${i}.pay`)}
              </div>
              <button
                type="button"
                onClick={() => onChange(tiers.filter((_, k) => k !== i))}
                aria-label={t("remove")}
                title={t("remove")}
                className={`${iconButton} mt-6`}
              >
                <Trash2 size={18} strokeWidth={1.8} aria-hidden />
              </button>
            </li>
          );
        })}
      </ul>
      <div>
        <button type="button" onClick={() => onChange([...tiers, { minPct: "", payKind: "fixed", pay: "" }])} className={secondaryButton}>
          <Plus size={18} strokeWidth={1.8} aria-hidden />
          {t("add")}
        </button>
      </div>
    </fieldset>
  );
}
