import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { inputValue } from "@/domain/money";
import { requireCtx } from "@/server/auth/guard";
import { getClose } from "@/server/repos/closes";
import { getMonthView } from "@/server/repos/month-view";
import { currentDay } from "@/server/today";
import { AppHeader } from "@/ui/components/AppHeader";
import type { ReturnRow } from "@/ui/components/ReturnsEditor";
import { INTL_TAG } from "@/ui/intl-tag";
import { resolveCloseDate } from "./close-date";
import { CloseForm, type FormItem } from "./close-form";

/** The three ways to record the day; only typing exists so far. */
function Methods({ labels }: { labels: { group: string; photo: string; voice: string; type: string; soon: string } }) {
  const base = "flex min-h-16 flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-2 text-[13px]";
  const off = `${base} border border-line bg-white font-medium text-muted opacity-70`;
  return (
    <div role="group" aria-label={labels.group} className="grid grid-cols-3 gap-2 px-5 pt-[18px]">
      {[labels.photo, labels.voice].map((l) => (
        <button key={l} type="button" disabled className={off}>
          {l}
          <span className="text-xs">{labels.soon}</span>
        </button>
      ))}
      <button
        type="button"
        aria-pressed="true"
        className={`${base} border-2 border-brand bg-brand-tint font-bold text-brand`}
      >
        {labels.type}
      </button>
    </div>
  );
}

export default async function ClosePage({ searchParams }: { searchParams: Promise<{ date?: string | string[] }> }) {
  const ctx = await requireCtx();
  const [t, home, locale, params] = await Promise.all([
    getTranslations("close"),
    getTranslations("home"),
    getLocale(),
    searchParams,
  ]);
  const today = currentDay(ctx.timeZone);
  const requested = Array.isArray(params.date) ? params.date[0] : params.date;
  const { date, selling } = await resolveCloseDate(ctx, today, requested);

  const d = new Date(`${date}T00:00:00Z`);
  const fmt = (o: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(INTL_TAG[locale as keyof typeof INTL_TAG] ?? "ar-EG", {
      ...o,
      numberingSystem: "latn",
      timeZone: "UTC",
    });
  const dateLine = t("dateLine", {
    weekday: fmt({ weekday: "long" }).format(d),
    day: d.getUTCDate(),
    month: fmt({ month: "long" }).format(d),
  });

  if (!selling) {
    return (
      <>
        <AppHeader greeting={t("title")} dateLine={dateLine} notificationsLabel={home("notifications")} />
        <main className="flex flex-1 flex-col gap-4 px-5 pb-4 pt-[18px]">
          <h2 className="m-0 text-[18px] font-bold">{t("notSellingTitle")}</h2>
          <p className="m-0 text-[14.5px] text-ink-2">{t("notSellingSub")}</p>
          <Link
            href="/app"
            className="flex min-h-[52px] items-center justify-center rounded-xl bg-brand text-base font-bold text-white no-underline hover:bg-brand-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
          >
            {t("backHome")}
          </Link>
        </main>
      </>
    );
  }

  const [year, month] = today.split("-").map(Number) as [number, number];
  const [view, saved] = await Promise.all([getMonthView(ctx, { year, month, today }), getClose(ctx, date)]);
  const lineName = (l: { nameAr: string; nameEn: string }) => (locale === "en" ? l.nameEn : l.nameAr);

  const lineItems: FormItem[] = view.lines.map((l) => ({
    name: `line.${l.lineId}`,
    label: lineName(l),
    unitLabel: home(`unit.${l.unit}`),
    mode: l.unit === "cases" ? "numeric" : "decimal",
    collection: l.kind === "collection",
  }));
  const focusItems: FormItem[] = view.focus.map((f) => ({
    name: `focus.${f.id}`,
    label: f.name,
    unitLabel: home(`unit.${f.unit}`),
    mode: f.unit === "cases" ? "numeric" : "decimal",
  }));

  const initial: Record<string, string> = {};
  if (saved) {
    for (const l of view.lines) {
      const n = saved.lines[l.lineId];
      if (n !== undefined) initial[`line.${l.lineId}`] = inputValue(n, l.unit);
    }
    for (const f of view.focus) {
      const n = saved.focus[f.id];
      if (n !== undefined) initial[`focus.${f.id}`] = inputValue(n, f.unit);
    }
    for (const k of ["cashSales", "creditSales", "collections", "expenses"] as const) {
      initial[k] = inputValue(saved[k], "value");
    }
    for (const k of ["loaded", "sold", "returned"] as const) initial[k] = inputValue(saved[k], "cases");
  }
  const initialReturns: ReturnRow[] = (saved?.returns ?? []).map((r, key) => ({
    key,
    description: r.description,
    quantity: inputValue(r.quantity, "cases"),
    reason: r.reason,
  }));

  return (
    <>
      <AppHeader greeting={t("title")} dateLine={dateLine} notificationsLabel={home("notifications")} />
      <Methods
        labels={{
          group: t("methodLabel"),
          photo: t("methodPhoto"),
          voice: t("methodVoice"),
          type: t("methodType"),
          soon: t("soon"),
        }}
      />
      <main className="flex flex-1 flex-col gap-3 px-5 pb-4 pt-3">
        <CloseForm
          date={date}
          lineItems={lineItems}
          focusItems={focusItems}
          initial={initial}
          initialReturns={initialReturns}
          currencyLabel={home("unit.value")}
          stockUnitLabel={home("unit.cases")}
        />
      </main>
    </>
  );
}
