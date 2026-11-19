"use client";

import { useActionState, useEffect, useState } from "react";
import { TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { AmountField } from "@/ui/components/AmountField";
import { PrimaryButton } from "@/ui/components/PrimaryButton";
import { ReconciliationPanel } from "@/ui/components/ReconciliationPanel";
import { ReturnsEditor, type ReturnRow } from "@/ui/components/ReturnsEditor";
import { parseAmount } from "@/domain/money";
import { saveCloseAction, type CloseState } from "./actions";

export type FormItem = {
  name: string;
  label: string;
  unitLabel: string;
  mode: "decimal" | "numeric";
  collection?: boolean;
  /** What the admin's upload recorded for this line, shown under the field. */
  notes?: string[];
};

const card = "rounded-[14px] border border-line bg-white px-4 py-1";
const heading = "m-0 px-1 text-[15px] font-bold";

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
      notes={it.notes}
    />
  );
  const money = (name: string): FormItem => ({ name, label: t(name), unitLabel: currencyLabel, mode: "decimal" });
  const stock = (name: string): FormItem => ({ name, label: t(name), unitLabel: stockUnitLabel, mode: "numeric" });
  const v = (name: string) => values[name] ?? "";
  const collectionItems = lineItems.filter((it) => it.collection);
  // A collection target line is the collections figure; only without one is it asked separately.
  const collections =
    collectionItems.length > 0
      ? collectionItems.reduce((sum, it) => sum + (parseAmount(v(it.name), "value") ?? 0), 0)
      : (parseAmount(v("collections"), "value") ?? 0);
  const moneyNames =
    collectionItems.length > 0
      ? ["cashSales", "creditSales", "expenses"]
      : ["cashSales", "creditSales", "collections", "expenses"];
  const stockOpen = ["loaded", "sold", "returned"].some(
    (n) => (initial[n] ?? "") !== "" || state.errors[n] !== undefined,
  );

  return (
    <form action={action} noValidate className="flex flex-col gap-3">
      <input type="hidden" name="date" value={date} />

      {Object.keys(state.errors).length > 0 && (
        <p role="alert" className="m-0 flex items-center gap-2 rounded-xl bg-alert-tint px-3.5 py-2.5 text-[13.5px] font-bold text-alert">
          <TriangleAlert aria-hidden="true" size={18} strokeWidth={2.2} className="shrink-0" />
          {err("date") ?? t("fixErrors")}
        </p>
      )}

      <section aria-labelledby="h-lines" className="flex flex-col gap-1.5">
        <h2 id="h-lines" className={heading}>
          {t("linesTitle")}
        </h2>
        <div className={card}>{lineItems.map((it) => field(it))}</div>
      </section>

      <section aria-labelledby="h-money" className="flex flex-col gap-1.5">
        <h2 id="h-money" className={heading}>
          {t("moneyTitle")}
        </h2>
        <div className={card}>{moneyNames.map((n) => field(money(n)))}</div>
      </section>

      {focusItems.length > 0 && (
        <section aria-labelledby="h-focus" className="flex flex-col gap-1.5">
          <h2 id="h-focus" className={heading}>
            {t("focusTitle")}
          </h2>
          <div className={card}>{focusItems.map((it) => field(it))}</div>
        </section>
      )}

      <details open={stockOpen || undefined} className="rounded-[14px] border border-line bg-white px-4">
        <summary className="flex min-h-12 cursor-pointer items-center text-[15px] font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
          {t("stockSummary")}
        </summary>
        {["loaded", "sold", "returned"].map((n) => field(stock(n)))}
      </details>

      <ReturnsEditor rows={rows} onChange={setRows} errors={errorMap} />

      <ReconciliationPanel
        cashSales={v("cashSales")}
        collections={collections}
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
