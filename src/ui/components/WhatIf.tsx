"use client";

import { useState } from "react";
import { Minus, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import type { Scheme, SchemeInput } from "@/domain/commission";
import { formatAmount, formatPercent, type Unit } from "@/domain/money";
import { whatIfAt } from "@/ui/what-if-state";

export type WhatIfLine = { lineId: string; name: string; unit: Unit };

/** Pick a line, step its daily rate, and see the month-end percent and commission, computed here with the pure engine. */
export function WhatIf({
  scheme,
  input,
  counts,
  today,
  lines,
  unitLabels,
  currencyLabel,
}: {
  scheme: Scheme;
  input: SchemeInput;
  counts: { total: number; elapsed: number; left: number };
  today: string;
  lines: WhatIfLine[];
  unitLabels: Record<Unit, string>;
  currencyLabel: string;
}) {
  const t = useTranslations("commission");
  const [lineId, setLineId] = useState(lines[0]?.lineId ?? "");
  const [steps, setSteps] = useState<Record<string, number>>({});
  const line = lines.find((l) => l.lineId === lineId);
  if (!line) return null;

  if (counts.left === 0) {
    return (
      <section aria-label={t("whatIfTitle")} className="flex flex-col gap-3 rounded-[14px] border border-line bg-white p-4">
        <h2 className="m-0 text-base font-bold">{t("whatIfTitle")}</h2>
        <p className="m-0 text-[13px] text-ink-2">{t("whatIfNoDays")}</p>
      </section>
    );
  }

  const n = steps[line.lineId] ?? 0;
  const r = whatIfAt(scheme, input, counts, line, n, today);
  const unitWord = unitLabels[line.unit];
  const move = (d: number) => setSteps((s) => ({ ...s, [line.lineId]: (s[line.lineId] ?? 0) + d }));

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
          aria-label={t("whatIfLess", { step: formatAmount(r.step, line.unit), unit: unitWord })}
          onClick={() => move(-1)}
          disabled={!r.canDecrease}
          className={stepBtn + " border border-line bg-white text-ink disabled:opacity-40"}
        >
          <Minus aria-hidden="true" size={24} strokeWidth={2} />
        </button>
        <div className="flex flex-col items-center">
          <span className="text-[34px] font-extrabold leading-[1.1]">
            <bdi dir="ltr">{formatAmount(r.rate, line.unit)}</bdi>
          </span>
          <span className="text-[13px] text-ink-2">{t("whatIfPerDay", { unit: unitWord })}</span>
        </div>
        <button
          type="button"
          aria-label={t("whatIfMore", { step: formatAmount(r.step, line.unit), unit: unitWord })}
          onClick={() => move(1)}
          className={stepBtn + " border-0 bg-brand text-white hover:bg-brand-hover"}
        >
          <Plus aria-hidden="true" size={24} strokeWidth={2} />
        </button>
      </div>
      <div aria-live="polite" className="grid grid-cols-2 gap-3 border-t border-line-soft pt-3">
        <div className="flex flex-col gap-px">
          <span className="text-[13px] text-ink-2">{t("whatIfMonthEnd")}</span>
          <span className="text-xl font-bold">
            <bdi dir="ltr">{formatPercent(r.endAchieved, r.target)}</bdi>
          </span>
        </div>
        <div className="flex flex-col gap-px">
          <span className="text-[13px] text-ink-2">{t("whatIfTotal")}</span>
          <span className="text-xl font-bold text-brand">
            <bdi dir="ltr">{formatAmount(r.total, "value")}</bdi>{" "}
            <span className="text-[13px] font-medium">{currencyLabel}</span>
          </span>
        </div>
      </div>
      <p className="m-0 text-[13px] text-ink-2">{t("whatIfNote", { left: counts.left })}</p>
    </section>
  );
}
