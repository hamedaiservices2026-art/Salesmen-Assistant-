"use client";

import { TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { formatAmount, parseAmount } from "@/domain/money";
import { reconcile } from "@/domain/reconciliation";

/** What the rep must hand over and what should be left in the van, recomputed as he types. */
export function ReconciliationPanel({
  cashSales,
  collections,
  expenses,
  loaded,
  sold,
  returned,
  currencyLabel,
  stockUnitLabel,
}: {
  cashSales: string;
  collections: number; // minor units, derived by the form
  expenses: string;
  loaded: string;
  sold: string;
  returned: string;
  currencyLabel: string;
  stockUnitLabel: string;
}) {
  const t = useTranslations("close");
  // An unreadable or empty field counts as 0 here only; the save path rejects it instead.
  const money = (v: string) => parseAmount(v, "value") ?? 0;
  const count = (v: string) => parseAmount(v, "cases") ?? 0;
  const i = {
    cashSales: money(cashSales),
    collections,
    expenses: money(expenses),
    loaded: count(loaded),
    sold: count(sold),
    returned: count(returned),
  };
  const r = reconcile(i);
  const showStock = [loaded, sold, returned].some((v) => v.trim() !== "");
  return (
    <section aria-label={t("panelTitle")} className="flex flex-col gap-3 rounded-[14px] bg-brand p-4 text-white">
      <h2 className="m-0 text-sm font-medium text-on-brand-2">{t("panelTitle")}</h2>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[15px] font-medium">{t("cashLabel")}</span>
        <span aria-live="polite" className="text-[26px] font-bold leading-[1.1]">
          <bdi dir="ltr">{formatAmount(r.cashToHandOver, "value")}</bdi>
          <span className="ms-1.5 text-sm font-medium">{currencyLabel}</span>
        </span>
      </div>
      <p className="m-0 text-[13px] text-on-brand-2">
        {t("cashFormula", {
          cash: formatAmount(i.cashSales, "value"),
          collections: formatAmount(i.collections, "value"),
          expenses: formatAmount(i.expenses, "value"),
        })}
      </p>
      {showStock && (
        <>
      <div className="flex items-baseline justify-between gap-3 border-t border-white/15 pt-3">
        <span className="text-[15px] font-medium">{t("stockLabel")}</span>
        <span aria-live="polite" className="text-lg font-bold">
          <bdi dir="ltr">{formatAmount(r.stockLeft, "cases")}</bdi>
          <span className="ms-1.5 text-[13px] font-medium">{stockUnitLabel}</span>
        </span>
      </div>
      <p className="m-0 text-[13px] text-on-brand-2">
        {t("stockFormula", {
          loaded: formatAmount(i.loaded, "cases"),
          sold: formatAmount(i.sold, "cases"),
          returned: formatAmount(i.returned, "cases"),
        })}
      </p>
        </>
      )}
      {r.warnings.map((w) => (
        <p
          key={w}
          role="alert"
          className="m-0 flex items-center gap-2 rounded-lg bg-alert-tint px-3 py-2 text-[13px] font-bold text-alert"
        >
          <TriangleAlert aria-hidden="true" size={16} strokeWidth={2.2} className="shrink-0" />
          {t(`warnings.${w}`)}
        </p>
      ))}
    </section>
  );
}
