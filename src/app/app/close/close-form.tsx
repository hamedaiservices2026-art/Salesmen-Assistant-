"use client";

import { useActionState, useEffect, useState } from "react";
import { TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { AmountField } from "@/ui/components/AmountField";
import { PrimaryButton } from "@/ui/components/PrimaryButton";
import { ReconciliationPanel } from "@/ui/components/ReconciliationPanel";
import { ReturnsEditor, type ReturnRow } from "@/ui/components/ReturnsEditor";
import { saveCloseAction, type CloseState } from "./actions";

export type FormItem = { name: string; label: string; unitLabel: string; mode: "decimal" | "numeric" };

const card = "rounded-[14px] border border-line bg-white px-4 py-1";

/** The typed day close. Everything the rep types lives in state, so an error never clears it. */
export function CloseForm({
  date,
  lineItems,
  focusItems,
  initial,
  initialReturns,
  currencyLabel,
  stockUnitLabel,
}: {
  date: string;
  lineItems: FormItem[];
  focusItems: FormItem[];
  initial: Record<string, string>;
  initialReturns: ReturnRow[];
  currencyLabel: string;
  stockUnitLabel: string;
}) {
  const t = useTranslations("close");
  const [state, action, pending] = useActionState<CloseState, FormData>(saveCloseAction, { errors: {} });
  const [values, setValues] = useState(initial);
  const [rows, setRows] = useState(initialReturns);

  useEffect(() => {
    if (Object.keys(state.errors).length > 0) {
      document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
    }
  }, [state]);

  const err = (name: string) => {
    const code = state.errors[name];
    return code ? t(`errors.${code}`) : undefined;
  };
  const errorMap: Record<string, string | undefined> = Object.fromEntries(
    Object.keys(state.errors).map((k) => [k, err(k)]),
  );
  const field = (it: FormItem, unitLabel: string | undefined = it.unitLabel) => (
    <AmountField
      key={it.name}
      name={it.name}
      label={it.label}
      unitLabel={unitLabel}
      mode={it.mode}
      value={values[it.name] ?? ""}
      onChange={(v) => setValues((s) => ({ ...s, [it.name]: v }))}
      error={err(it.name)}
    />
  );
  const money = (name: string): FormItem => ({ name, label: t(name), unitLabel: currencyLabel, mode: "decimal" });
  const stock = (name: string): FormItem => ({ name, label: t(name), unitLabel: stockUnitLabel, mode: "numeric" });
  const v = (name: string) => values[name] ?? "";

  return (
    <form action={action} noValidate className="flex flex-col gap-3">
      <input type="hidden" name="date" value={date} />

      {Object.keys(state.errors).length > 0 && (
        <p role="alert" className="m-0 flex items-center gap-2 rounded-xl bg-alert-tint px-3.5 py-2.5 text-[13.5px] font-bold text-alert">
          <TriangleAlert aria-hidden="true" size={18} strokeWidth={2.2} className="shrink-0" />
          {err("date") ?? t("fixErrors")}
        </p>
      )}

      <section aria-label={t("linesTitle")} className={card}>
        {lineItems.map((it) => field(it))}
      </section>

      <section aria-label={t("moneyTitle")} className={card}>
        {["cashSales", "creditSales", "collections", "expenses"].map((n) => field(money(n)))}
      </section>

      <section aria-label={t("stockTitle")} className={card}>
        {["loaded", "sold", "returned"].map((n) => field(stock(n)))}
      </section>

      {focusItems.length > 0 && (
        <section aria-label={t("focusTitle")} className={card}>
          {focusItems.map((it) => field(it))}
        </section>
      )}

      <ReturnsEditor rows={rows} onChange={setRows} errors={errorMap} />

      <ReconciliationPanel
        cashSales={v("cashSales")}
        collections={v("collections")}
        expenses={v("expenses")}
        loaded={v("loaded")}
        sold={v("sold")}
        returned={v("returned")}
        currencyLabel={currencyLabel}
        stockUnitLabel={stockUnitLabel}
      />

      <PrimaryButton disabled={pending}>{pending ? t("submitting") : t("submit")}</PrimaryButton>
    </form>
  );
}
