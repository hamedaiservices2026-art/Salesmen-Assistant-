import { getLocale, getTranslations } from "next-intl/server";
import { requireCtx } from "@/server/auth/guard";
import { getMonthView } from "@/server/repos/month-view";
import { getDisplayName } from "@/server/repos/profile";
import { currentDay } from "@/server/today";
import { formatAmount, formatPercent, type Unit } from "@/domain/money";
import { todayNeed } from "@/domain/pace";
import { AppHeader } from "@/ui/components/AppHeader";
import { FocusList } from "@/ui/components/FocusList";
import { LineTabs } from "@/ui/components/LineTabs";
import { MonthCalendar } from "@/ui/components/MonthCalendar";
import { PrimaryLink } from "@/ui/components/PrimaryLink";
import { StatusChip } from "@/ui/components/StatusChip";
import { TodayPanel } from "@/ui/components/TodayPanel";
import { calendarCells } from "@/ui/components/calendar-cells";
import { INTL_TAG } from "@/ui/intl-tag";

export default async function HomePage({ searchParams }: { searchParams: Promise<{ line?: string | string[] }> }) {
  const ctx = await requireCtx();
  const [t, tSettings, locale, params] = await Promise.all([
    getTranslations("home"),
    getTranslations("settings"),
    getLocale(),
    searchParams,
  ]);
  const today = currentDay(ctx.timeZone);
  const [year, month] = today.split("-").map(Number) as [number, number];
  const [view, name] = await Promise.all([getMonthView(ctx, { year, month, today }), getDisplayName(ctx)]);

  const lineParam = Array.isArray(params.line) ? params.line[0] : params.line;
  const line = view.lines.find((l) => l.lineId === lineParam) ?? view.lines[0];
  const loc = locale as keyof typeof INTL_TAG;
  const fmt = (o: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(INTL_TAG[loc] ?? "ar-EG", { ...o, numberingSystem: "latn", timeZone: "UTC" });
  const lineName = (l: { nameAr: string; nameEn: string }) => (locale === "en" ? l.nameEn : l.nameAr);

  const todayDate = new Date(`${today}T00:00:00Z`);
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: ctx.timeZone }).format(new Date()),
  );
  const greeting = t(hour < 12 ? "greetingMorning" : "greetingEvening", { name });
  const dateLine = t("dateLine", {
    weekday: fmt({ weekday: "long" }).format(todayDate),
    day: todayDate.getUTCDate(),
    month: fmt({ month: "long" }).format(todayDate),
    n: Math.min(view.counts.elapsed + 1, view.counts.total),
    total: view.counts.total,
  });

  const tabs = view.lines.map((l) => ({
    id: l.lineId,
    name: lineName(l),
    pct: l.pace.pct === null ? "—" : formatPercent(l.achieved, l.target),
  }));

  if (!line) {
    return (
      <>
        <AppHeader greeting={greeting} dateLine={dateLine} notificationsLabel={t("notifications")} settingsLabel={tSettings("open")} />
        <main className="flex flex-1 flex-col gap-4 px-5 pb-4 pt-[18px]">
          <p className="m-0 text-base text-ink-2">{t("noLines")}</p>
          <PrimaryLink href="/app/close">{t("close")}</PrimaryLink>
        </main>
      </>
    );
  }

  const unit: Unit = line.unit;
  const unitLabel = t(`unit.${unit}`);
  const amt = (n: number) => formatAmount(n, unit);
  const { pace } = line;

  // Weekday header: catalog short names (Sunday 0) starting at the company's week start.
  const shortNames = t.raw("weekdaysShort") as string[];
  const weekdays: string[] = [];
  const fridayIndexes: number[] = [];
  for (let i = 0; i < 7; i++) {
    const wd = (view.weekStartsOn + i) % 7;
    weekdays.push(shortNames[wd] ?? "");
    if (wd === 5) fridayIndexes.push(i);
  }

  const cells = calendarCells(line, view.weekStartsOn);
  const hit = line.days.filter((d) => d.mark === "hit").length;
  const below = line.days.filter((d) => d.mark === "below").length;
  const hasMissing = line.days.some((d) => d.mark === "missing");
  const hasRecorded = line.days.some((d) => d.mark === "recorded");
  const need = todayNeed({
    isSellingDay: view.todaySelling,
    hasClosedToday: view.hasClosedToday,
    requiredDaily: pace.requiredDaily,
    nextDayRequired: line.nextDayRequired,
    noTarget: pace.status === "no_target",
  });
  const summary =
    t("calendarSummary", { month: fmt({ month: "long" }).format(todayDate), hit, below, day: todayDate.getUTCDate() }) +
    (need.kind === "need" && need.amount !== null
      ? t("calendarSummaryRequired", { required: amt(need.amount), unit: unitLabel })
      : "");

  let panel: React.ReactNode = null;
  if (need.kind === "done") {
    panel = (
      <TodayPanel
        label={t("needLabel")}
        title={t("doneTitle")}
        sub={need.amount === null ? t("doneLast") : t("doneSub")}
        amount={need.amount === null ? null : amt(need.amount)}
        unitLabel={unitLabel}
      />
    );
  } else if (need.kind === "off") {
    panel = (
      <TodayPanel
        label={t("needLabel")}
        title={t("offTitle")}
        sub={need.amount === null ? null : t("offSub")}
        amount={need.amount === null ? null : amt(need.amount)}
        unitLabel={unitLabel}
      />
    );
  } else if (need.kind === "need" && need.amount !== null) {
    panel = (
      <TodayPanel
        label={t("needLabel")}
        title={t("needTitle")}
        sub={t("needSub", { remaining: amt(pace.remaining), left: view.counts.left })}
        amount={amt(need.amount)}
        unitLabel={unitLabel}
      />
    );
  }

  const focusRows = view.focus.map((f) => {
    const remaining = Math.max(0, f.target - f.achieved);
    const rem = formatAmount(remaining, f.unit);
    const detail =
      remaining === 0
        ? t("focusDone")
        : f.perDay === null
          ? t("focusRemaining", { remaining: rem })
          : t.rich("focusRow", {
              perDay: formatAmount(f.perDay, f.unit),
              remaining: rem,
              b: (chunks) => <strong className="font-extrabold text-ink">{chunks}</strong>,
            });
    return { id: f.id, name: f.name, detail };
  });

  return (
    <>
      <AppHeader greeting={greeting} dateLine={dateLine} notificationsLabel={t("notifications")} settingsLabel={tSettings("open")}>
        <LineTabs lines={tabs} selectedId={line.lineId} label={t("tabsLabel")} />
      </AppHeader>
      <main className="flex flex-1 flex-col gap-4 px-5 pb-4 pt-[18px]">
        <section aria-label={t("lineLabel", { line: lineName(line) })} className="flex flex-col gap-1.5">
          <div className="flex items-baseline gap-2.5">
            <span className="text-[46px] font-extrabold leading-none tracking-[-0.02em]">{amt(line.achieved)}</span>
            {line.target > 0 && (
              <span className="text-[14.5px] text-ink-2">
                {t("ofTarget", { target: amt(line.target), unit: unitLabel })}
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusChip
              status={pace.status}
              behindText={t("behind", { gap: amt(Math.max(0, pace.gap)), unit: unitLabel })}
              aheadText={t("ahead")}
              noTargetText={t("noTarget")}
            />
            {pace.status !== "no_target" && (
              <span className="text-[13px] text-ink-2">{t("expected", { expected: amt(pace.expected) })}</span>
            )}
          </div>
        </section>

        <MonthCalendar
          cells={cells}
          today={today}
          unit={unit}
          weekdays={weekdays}
          fridayIndexes={fridayIndexes}
          ariaLabel={summary}
          sectionLabel={t("daysLabel")}
          todayLabel={t("today")}
          missingLabel={(day) => t("missingLink", { day })}
          legend={{
            hit: t("legendHit"),
            below: t("legendBelow"),
            missing: hasMissing ? t("legendMissing") : null,
            recorded: hasRecorded ? t("legendRecorded") : null,
          }}
        />

        {panel}
        <FocusList title={t("focusTitle")} rows={focusRows} />
        <PrimaryLink href="/app/close">{t("close")}</PrimaryLink>
      </main>
    </>
  );
}
