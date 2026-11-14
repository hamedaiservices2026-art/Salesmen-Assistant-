"use client";

import { Plus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { AmountField } from "./AmountField";

export type ReturnRow = { key: number; description: string; quantity: string; reason: string };

const REASONS = ["expired", "damaged", "other"] as const;
const inputClass =
  "box-border h-12 w-full rounded-[10px] border border-line bg-white px-3 text-[15px] text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";

/** Returned goods: add and remove rows of description, quantity and reason. Photos come later. */
export function ReturnsEditor({
  rows,
  onChange,
  errors,
}: {
  rows: ReturnRow[];
  onChange: (rows: ReturnRow[]) => void;
  errors: Record<string, string | undefined>;
}) {
  const t = useTranslations("close");
  const set = (key: number, patch: Partial<ReturnRow>) =>
    onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const nextKey = rows.reduce((m, r) => Math.max(m, r.key), -1) + 1;
  return (
    <section aria-label={t("returnsTitle")} className="flex flex-col gap-3 rounded-[14px] border border-line bg-white p-4">
      <h2 className="m-0 text-[15px] font-bold">{t("returnsTitle")}</h2>
      {rows.map((r, i) => (
        <fieldset key={r.key} className="m-0 flex flex-col gap-2 rounded-xl border border-line-soft p-3">
          <legend className="px-1 text-[13px] font-semibold text-ink-2">{t("returnsRow", { n: i + 1 })}</legend>
          <label className="flex flex-col gap-1 text-[13px] text-ink-2">
            {t("returnDescription")}
            <input
              name={`ret.${i}.description`}
              type="text"
              autoComplete="off"
              value={r.description}
              onChange={(e) => set(r.key, { description: e.target.value })}
              className={inputClass}
            />
          </label>
          <AmountField
            name={`ret.${i}.quantity`}
            label={t("returnQuantity")}
            mode="numeric"
            value={r.quantity}
            onChange={(v) => set(r.key, { quantity: v })}
            error={errors[`ret.${i}.quantity`]}
          />
          <label className="flex flex-col gap-1 text-[13px] text-ink-2">
            {t("returnReason")}
            <select
              name={`ret.${i}.reason`}
              value={r.reason}
              onChange={(e) => set(r.key, { reason: e.target.value })}
              className={inputClass}
            >
              {REASONS.map((x) => (
                <option key={x} value={x}>
                  {t(`reasons.${x}`)}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => onChange(rows.filter((x) => x.key !== r.key))}
            className="inline-flex min-h-11 items-center justify-center gap-1.5 self-start rounded-[10px] border border-line bg-white px-3.5 text-sm font-semibold text-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            <X aria-hidden="true" size={18} strokeWidth={2} />
            {t("returnsRemove")}
          </button>
        </fieldset>
      ))}
      <button
        type="button"
        onClick={() => onChange([...rows, { key: nextKey, description: "", quantity: "", reason: "expired" }])}
        className="inline-flex min-h-12 items-center justify-center gap-1.5 rounded-[10px] border border-line bg-white px-3.5 text-sm font-semibold text-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        <Plus aria-hidden="true" size={18} strokeWidth={2} />
        {t("returnsAdd")}
      </button>
    </section>
  );
}
