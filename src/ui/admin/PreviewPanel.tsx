"use client";

import { useLocale, useTranslations } from "next-intl";
import { componentLabel, type Component, type Evaluation, type NearestWin } from "@/domain/commission";
import { formatAmount, type Unit } from "@/domain/money";
import type { Locale } from "@/i18n/config";
import { explainResult } from "@/ui/commission-copy";
import { CommissionBreakdown } from "@/ui/components/CommissionBreakdown";
import { fieldInput, fieldLabel, fieldOk } from "./form-styles";

export type PreviewView =
  | { status: "loading" | "incomplete" | "failed" | "no_reps" }
  | { status: "issues"; messages: string[] }
  | {
      status: "ok";
      /** The components the numbers were computed from (for the labels). */
      components: Component[];
      actual: Evaluation;
      projected: Evaluation;
      atFullTarget: Evaluation;
      nearest: NearestWin;
    };

/**
 * What a chosen rep would see on his commission screen if the typed plan were published: the three
 * totals, the same breakdown rows and sentences, and the nearest win. Validation problems replace
 * the numbers.
 */
export function PreviewPanel({
  reps,
  repId,
  onRepChange,
  view,
  names,
  units,
  currencyLabel,
  unitLabels,
}: {
  reps: { id: string; name: string }[];
  repId: string;
  onRepChange: (id: string) => void;
  view: PreviewView;
  /** Line, focus item and gate names for the sentences. */
  names: Record<string, string>;
  units: Record<string, Unit>;
  currencyLabel: string;
  unitLabels: Record<Unit, string>;
}) {
  const t = useTranslations("admin.schemes.preview");
  const tc = useTranslations("commission");
  const locale = useLocale() as Locale;
  const translate = (key: string, values?: Record<string, string | number>) => tc(key as never, values as never);

  const total = (n: number) => (
    <>
      <bdi dir="ltr">{formatAmount(n, "value")}</bdi> <span className="text-[13px] font-medium">{currencyLabel}</span>
    </>
  );

  let body: React.ReactNode;
  if (view.status === "ok") {
    const labels: Record<string, string> = {};
    const allNames = { ...names };
    for (const c of view.components) {
      labels[c.id] = componentLabel(c, locale);
      if (c.type === "gate") allNames[c.id] = labels[c.id]!;
    }
    const fmt = (n: number, id?: string) => formatAmount(n, (id && units[id]) || "cases");
    const rows = view.projected.results.map((r) => ({
      id: r.componentId,
      label: labels[r.componentId] ?? r.label,
      sentence: explainResult(r, translate, allNames, fmt),
      amount: formatAmount(r.amount, "value"),
    }));
    const n = view.nearest;
    const nid = n?.lineId ?? n?.focusItemId;
    const nUnit: Unit = (nid ? units[nid] : undefined) ?? "cases";
    body = (
      <>
        <section aria-label={tc("heroLabel")} className="flex flex-col gap-1 rounded-xl bg-brand px-4 py-4 text-white">
          <h3 className="m-0 text-[13px] font-medium text-on-brand-2">{tc("heroLabel")}</h3>
          <span data-testid="preview-projected" className="text-[34px] font-extrabold leading-none tracking-[-0.02em]">
            {total(view.projected.total)}
          </span>
          <dl className="m-0 mt-2 grid grid-cols-2 gap-3 border-t border-white/20 pt-3">
            <div className="flex flex-col gap-px">
              <dt className="text-[12.5px] text-on-brand-2">{tc("earnedLabel")}</dt>
              <dd data-testid="preview-actual" className="m-0 text-[16px] font-bold">
                {total(view.actual.total)}
              </dd>
            </div>
            <div className="flex flex-col gap-px">
              <dt className="text-[12.5px] text-on-brand-2">{tc("fullLabel")}</dt>
              <dd data-testid="preview-full" className="m-0 text-[16px] font-bold">
                {total(view.atFullTarget.total)}
              </dd>
            </div>
          </dl>
        </section>
        {rows.length === 0 ? (
          <p className="m-0 rounded-xl bg-canvas px-4 py-3 text-[14px] text-ink-2">{t("emptyScheme")}</p>
        ) : (
          <CommissionBreakdown title={tc("breakdownTitle")} label={tc("breakdownLabel")} rows={rows} unitLabel={currencyLabel} />
        )}
        {n && (
          <section aria-label={tc("nearestTitle")} className="flex flex-col gap-px rounded-xl bg-brand-tint px-4 py-3">
            <h3 className="m-0 text-[15px] font-bold">{tc("nearestTitle")}</h3>
            <span className="text-[13px] text-ink-2">
              {tc("nearestBody", {
                name: (nid ? names[nid] : undefined) ?? labels[n.componentId] ?? n.label,
                gap: formatAmount(n.gap, nUnit),
                unit: unitLabels[nUnit],
              })}
            </span>
            <span className="text-[13px] font-semibold text-brand">
              {tc("nearestGain", { gain: formatAmount(n.gain, "value"), currency: currencyLabel })}
            </span>
          </section>
        )}
        <p className="m-0 text-[12.5px] text-ink-2">{t("same")}</p>
      </>
    );
  } else if (view.status === "issues") {
    body = (
      <div role="alert" className="flex flex-col gap-2 rounded-xl bg-alert-tint px-4 py-3 text-alert">
        <p className="m-0 text-[14px] font-semibold">{t("issues")}</p>
        <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[13.5px]">
          {view.messages.map((m, i) => (
            <li key={i}>{m}</li>
          ))}
        </ul>
      </div>
    );
  } else {
    body = (
      <p role="status" className="m-0 rounded-xl bg-canvas px-4 py-3 text-[14px] text-ink-2">
        {view.status === "loading" ? t("loading") : view.status === "incomplete" ? t("incomplete") : view.status === "no_reps" ? t("noReps") : t("failed")}
      </p>
    );
  }

  return (
    <aside aria-label={t("title")} className="flex min-w-0 flex-col gap-4 rounded-[14px] border border-line bg-white p-5">
      <h2 className="m-0 text-[17px] font-bold text-ink">{t("title")}</h2>
      {reps.length > 0 && (
        <div>
          <label className={fieldLabel} htmlFor="preview-rep">
            {t("repLabel")}
          </label>
          <select id="preview-rep" value={repId} onChange={(e) => onRepChange(e.target.value)} className={`${fieldInput} ${fieldOk}`}>
            {reps.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </div>
      )}
      {body}
    </aside>
  );
}
