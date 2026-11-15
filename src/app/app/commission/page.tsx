import { getLocale, getTranslations } from "next-intl/server";
import { requireCtx } from "@/server/auth/guard";
import { getCommissionView } from "@/server/repos/commission";
import { getMonthView } from "@/server/repos/month-view";
import { currentDay } from "@/server/today";
import type { Component } from "@/domain/commission";
import { formatAmount, type Unit } from "@/domain/money";
import { AppHeader } from "@/ui/components/AppHeader";
import { CommissionBreakdown } from "@/ui/components/CommissionBreakdown";
import { TierTable, type TierCell } from "@/ui/components/TierTable";
import { WhatIf } from "@/ui/components/WhatIf";
import { explainResult } from "@/ui/commission-copy";
import { INTL_TAG } from "@/ui/intl-tag";

/** Basis points as a percent without floating point: 50 gives "0.5", 100 gives "1". */
function bpsText(bps: number): string {
  const frac = bps % 100;
  return frac === 0 ? String(bps / 100) : `${Math.floor(bps / 100)}.${String(frac).padStart(2, "0").replace(/0$/, "")}`;
}

export default async function CommissionPage() {
  const ctx = await requireCtx();
  const [t, tHome, locale] = await Promise.all([getTranslations("commission"), getTranslations("home"), getLocale()]);
  const today = currentDay(ctx.timeZone);
  const [year, month] = today.split("-").map(Number) as [number, number];
  const [view, monthView] = await Promise.all([
    getCommissionView(ctx, { year, month, today }),
    getMonthView(ctx, { year, month, today }),
  ]);

  const loc = locale as keyof typeof INTL_TAG;
  const monthName = new Intl.DateTimeFormat(INTL_TAG[loc] ?? "ar-EG", {
    month: "long",
    numberingSystem: "latn",
    timeZone: "UTC",
  }).format(new Date(`${today}T00:00:00Z`));
  const dateLine = t("dateLine", {
    month: monthName,
    n: Math.min(view.counts.elapsed + 1, view.counts.total),
    total: view.counts.total,
  });

  const currency = tHome("unit.value");
  const lineName = (l: { nameAr: string; nameEn: string }) => (locale === "en" ? l.nameEn : l.nameAr);
  const { scheme } = view;

  if (!scheme) {
    return (
      <>
        <AppHeader greeting={t("title")} dateLine={dateLine} notificationsLabel={tHome("notifications")} />
        <main className="flex flex-1 flex-col gap-2 px-5 pb-4 pt-[18px]">
          <section aria-label={t("emptyTitle")} className="flex flex-col gap-1.5 rounded-xl bg-brand-tint px-4 py-3.5">
            <h2 className="m-0 text-[15px] font-bold">{t("emptyTitle")}</h2>
            <p className="m-0 text-sm text-ink-2">{t("emptyBody")}</p>
          </section>
        </main>
      </>
    );
  }

  const units: Record<string, Unit> = {};
  const names: Record<string, string> = {};
  for (const l of view.lines) {
    units[l.lineId] = l.unit;
    names[l.lineId] = lineName(l);
  }
  for (const f of monthView.focus) {
    units[f.id] = f.unit;
    names[f.id] = f.name;
  }
  for (const c of scheme.components) if (c.type === "gate") names[c.id] = c.label;

  const fmt = (n: number, id?: string) => formatAmount(n, (id && units[id]) || "cases");
  const results = view.projected.results;

  const rows = results.map((r) => ({
    id: r.componentId,
    label: r.label,
    sentence: explainResult(r, t, names, fmt),
    amount: formatAmount(r.amount, "value"),
  }));

  const tierTables = scheme.components
    .filter((c): c is Extract<Component, { type: "tiered" }> => c.type === "tiered")
    .map((c) => {
      const result = results.find((r) => r.componentId === c.id);
      const tiers = [...c.tiers].sort((a, b) => a.minPct - b.minPct);
      const reached = result?.reason === "tier" ? result.detail.tierMinPct : undefined;
      const below = result?.reason === "below_first_tier";
      const first = tiers[0];
      const cells: TierCell[] = [];
      if (first) cells.push({ id: "below", label: t("tierBelow", { pct: first.minPct }), pay: "0", here: below });
      for (const tier of tiers) {
        cells.push({
          id: String(tier.minPct),
          label: t("tierFrom", { pct: tier.minPct }),
          pay:
            tier.pay.kind === "fixed"
              ? formatAmount(tier.pay.amount, "value")
              : t("tierPay", { pct: bpsText(tier.pay.bps) }),
          here: reached === tier.minPct,
        });
      }
      return { id: c.id, title: t("tiersTitle", { label: c.label }), cells };
    });

  const nearest = view.nearest;
  const nearestId = nearest?.lineId ?? nearest?.focusItemId;
  const nearestName = (nearestId ? names[nearestId] : undefined) ?? nearest?.label ?? "";
  const nearestUnit: Unit = (nearestId ? units[nearestId] : undefined) ?? "cases";

  const unitLabels = { cases: tHome("unit.cases"), value: currency };
  const whatIfLines = view.lines.map((l) => ({ lineId: l.lineId, name: lineName(l), unit: l.unit }));

  return (
    <>
      <AppHeader greeting={t("title")} dateLine={dateLine} notificationsLabel={tHome("notifications")}>
        <section aria-label={t("heroLabel")} className="flex flex-col gap-1.5">
          <h2 className="m-0 text-sm font-medium text-on-brand-2">
            {t("heroLabel")} · {t("heroSub")}
          </h2>
          <span className="text-[46px] font-extrabold leading-none tracking-[-0.02em]">
            <bdi dir="ltr">{formatAmount(view.projected.total, "value")}</bdi>{" "}
            <span className="text-lg font-medium tracking-normal">{currency}</span>
          </span>
          <dl className="m-0 mt-1.5 grid grid-cols-2 gap-3 border-t border-white/20 pt-3">
            <div className="flex flex-col gap-px">
              <dt className="text-[13px] text-on-brand-2">{t("earnedLabel")}</dt>
              <dd className="m-0 text-[17px] font-bold">
                <bdi dir="ltr">{formatAmount(view.actual.total, "value")}</bdi> <span className="text-[13px] font-medium">{currency}</span>
              </dd>
            </div>
            <div className="flex flex-col gap-px">
              <dt className="text-[13px] text-on-brand-2">{t("fullLabel")}</dt>
              <dd className="m-0 text-[17px] font-bold">
                <bdi dir="ltr">{formatAmount(view.atFullTarget.total, "value")}</bdi> <span className="text-[13px] font-medium">{currency}</span>
              </dd>
            </div>
          </dl>
        </section>
      </AppHeader>
      <main className="flex flex-1 flex-col gap-4 px-5 pb-4 pt-[18px]">
        <CommissionBreakdown title={t("breakdownTitle")} label={t("breakdownLabel")} rows={rows} unitLabel={currency} />
        {tierTables.map((tt) => (
          <TierTable key={tt.id} title={tt.title} cells={tt.cells} hereLabel={t("tierHere")} />
        ))}
        {nearest && (
          <section aria-label={t("nearestTitle")} className="flex items-center justify-between gap-3 rounded-xl bg-brand-tint px-4 py-3.5">
            <div className="flex min-w-0 flex-col gap-px">
              <h2 className="m-0 text-[15px] font-bold">{t("nearestTitle")}</h2>
              <span className="text-[13px] text-ink-2">
                {t("nearestBody", {
                  name: nearestName,
                  gap: formatAmount(nearest.gap, nearestUnit),
                  unit: unitLabels[nearestUnit],
                })}
              </span>
              <span className="text-[13px] font-semibold text-brand">
                {t("nearestGain", { gain: formatAmount(nearest.gain, "value"), currency })}
              </span>
            </div>
          </section>
        )}
        <WhatIf
          scheme={scheme}
          input={view.input}
          counts={view.counts}
          lines={whatIfLines}
          unitLabels={unitLabels}
          currencyLabel={currency}
        />
      </main>
    </>
  );
}
