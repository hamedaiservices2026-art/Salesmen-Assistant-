"use client";

import { useState } from "react";
import { Minus, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { evaluateScheme, whatIf, type Scheme, type SchemeInput } from "@/domain/commission";
import { formatAmount, formatPercent, type Unit } from "@/domain/money";

export type WhatIfLine = { lineId: string; name: string; unit: Unit };

const STEP: Record<Unit, number> = { cases: 5, value: 50_000 };

/** The rep's average per selling day so far, rounded; 0 before any day has elapsed. */
function startRate(achieved: number, elapsed: number): number {
  return elapsed === 0 ? 0 : Math.round(achieved / elapsed);
}

/** Pick a line, step its daily rate, and see the month-end percent and commission, computed here with the pure engine. */
export function WhatIf({
  scheme,
  input,
  counts,
  lines,
  unitLabels,
  currencyLabel,
}: {
  scheme: Scheme;
  input: SchemeInput;
  counts: { total: number; elapsed: number; left: number };
  lines: WhatIfLine[];
  unitLabels: Record<Unit, string>;
  currencyLabel: string;
}) {
  const t = useTranslations("commission");
  const [lineId, setLineId] = useState(lines[0]?.lineId ?? "");
  const [rates, setRates] = useState<Record<string, number>>({});
  const line = lines.find((l) => l.lineId === lineId);
  if (!line) return null;

  const metric = input.lines[line.lineId] ?? { target: 0, achieved: 0 };
  const rate = rates[line.lineId] ?? startRate(metric.achieved, counts.elapsed);
  const step = STEP[line.unit];
  const unitWord = unitLabels[line.unit];
  const setRate = (next: number) => setRates((r) => ({ ...r, [line.lineId]: Math.max(0, next) }));

  const projected = whatIf(input, counts, line.lineId, rate);
  const end = projected.lines[line.lineId] ?? metric;
  const total = evaluateScheme(scheme, projected).total;

  const stepBtn =
    "flex size-[52px] shrink-0 items-center justify-center rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";

  return (
    <section aria-label={t("whatIfTitle")} className="flex flex-col gap-3 rounded-[14px] border border-line bg-white p-4">
      <h2 className="m-0 text-base font-bold">{t("whatIfTitle")}</h2>
      <div role="group" aria-label={t("whatIfLines")} className="grid grid-flow-col auto-cols-fr gap-1.5">
        {lines.map((l) => {
          const selected = l.lineId === line.lineId;
          return (
            <button
              key={l.lineId}
              type="button"
              aria-pressed={selected}
              onClick={() => setLineId(l.lineId)}
              className={
                "min-h-12 rounded-[10px] border px-1 text-[13.5px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink " +
                (selected ? "border-brand bg-brand font-bold text-white" : "border-line bg-white font-medium text-ink")
              }
            >
              {l.name}
            </button>
          );
        })}
      </div>
      <p className="m-0 text-[14.5px] font-medium">{t("whatIfPrompt")}</p>
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          aria-label={t("whatIfLess", { step: formatAmount(step, line.unit), unit: unitWord })}
          onClick={() => setRate(rate - step)}
          disabled={rate <= 0}
          className={stepBtn + " border border-line bg-white text-ink disabled:opacity-40"}
        >
          <Minus aria-hidden="true" size={24} strokeWidth={2} />
        </button>
        <div className="flex flex-col items-center">
          <span className="text-[34px] font-extrabold leading-[1.1]">
            <bdi dir="ltr">{formatAmount(rate, line.unit)}</bdi>
          </span>
          <span className="text-[13px] text-ink-2">{t("whatIfPerDay", { unit: unitWord })}</span>
        </div>
        <button
          type="button"
          aria-label={t("whatIfMore", { step: formatAmount(step, line.unit), unit: unitWord })}
          onClick={() => setRate(rate + step)}
          className={stepBtn + " border-0 bg-brand text-white hover:bg-brand-hover"}
        >
          <Plus aria-hidden="true" size={24} strokeWidth={2} />
        </button>
      </div>
      <div aria-live="polite" className="grid grid-cols-2 gap-3 border-t border-line-soft pt-3">
        <div className="flex flex-col gap-px">
          <span className="text-[13px] text-ink-2">{t("whatIfMonthEnd")}</span>
          <span className="text-xl font-bold">
            <bdi dir="ltr" data-testid="whatif-pct">{formatPercent(end.achieved, end.target)}</bdi>
          </span>
        </div>
        <div className="flex flex-col gap-px">
          <span className="text-[13px] text-ink-2">{t("whatIfTotal")}</span>
          <span className="text-xl font-bold text-brand">
            <bdi dir="ltr" data-testid="whatif-total">{formatAmount(total, "value")}</bdi>{" "}
            <span className="text-[13px] font-medium">{currencyLabel}</span>
          </span>
        </div>
      </div>
      <p className="m-0 text-[13px] text-ink-2">{t("whatIfNote", { left: counts.left })}</p>
    </section>
  );
}
