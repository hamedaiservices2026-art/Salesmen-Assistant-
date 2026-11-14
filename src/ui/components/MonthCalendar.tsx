import Link from "next/link";
import type { ISODate } from "@/domain/calendar";
import type { DayMark } from "@/domain/pace";
import { formatAmount, type Unit } from "@/domain/money";
import type { CalendarCell } from "./calendar-cells";

const base = "box-border flex h-[46px] flex-col justify-center rounded-lg leading-[1.2]";

function cellClass(mark: DayMark, isToday: boolean): string {
  const ring = isToday && mark !== "today" ? " outline-[2.5px] -outline-offset-[2.5px] outline-ink" : "";
  switch (mark) {
    case "hit":
      return `${base} bg-brand text-white${ring}`;
    case "below":
      return `${base} bg-cell text-cell-ink${ring}`;
    case "missing":
      return `${base} border border-dashed border-line text-ink-2`;
    case "today":
      return `${base} border-[2.5px] border-ink bg-white text-ink`;
    case "future":
      return `${base} border border-line text-ink-2`;
    case "off":
      return `${base} text-muted`;
  }
}

/** The month as a grid: each selling day is marked hit, below, missing, today or future. */
export function MonthCalendar({
  cells,
  today,
  unit,
  weekdays,
  fridayIndexes,
  ariaLabel,
  sectionLabel,
  todayLabel,
  missingLabel,
  legend,
}: {
  cells: (CalendarCell | null)[];
  today: ISODate;
  unit: Unit;
  weekdays: string[];
  fridayIndexes: number[];
  ariaLabel: string;
  sectionLabel: string;
  todayLabel: string;
  missingLabel: (day: number) => string;
  legend: { hit: string; below: string; missing: string | null };
}) {
  return (
    <section aria-label={sectionLabel} className="flex flex-col gap-1.5">
      <div aria-hidden="true" className="grid grid-cols-7 gap-1 text-center text-xs font-medium text-ink-2">
        {weekdays.map((w, i) => (
          <span key={i} className={fridayIndexes.includes(i) ? "text-muted" : undefined}>
            {w}
          </span>
        ))}
      </div>
      <div role="group" aria-label={ariaLabel} className="grid grid-cols-7 gap-1 text-center">
        {cells.map((c, i) => {
          if (!c) return <div key={`pad-${i}`} aria-hidden="true" />;
          const off = c.mark === "off";
          const quiet = c.mark === "future" || c.mark === "missing";
          if (c.mark === "missing") {
            return (
              <Link
                key={c.date}
                href={`/app/close?date=${c.date}`}
                aria-label={missingLabel(c.day)}
                className={`${cellClass(c.mark, c.date === today)} no-underline hover:bg-brand-tint focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand`}
              >
                <span className="text-[15px] font-semibold">{c.day}</span>
                <span className="text-xs font-medium">—</span>
              </Link>
            );
          }
          return (
            <div key={c.date} className={cellClass(c.mark, c.date === today)}>
              <span className={"text-[15px] " + (quiet ? "font-semibold" : "font-extrabold")}>{c.day}</span>
              {c.mark === "today" && <span className="text-xs font-bold">{todayLabel}</span>}
              {!off && c.amount !== null && (c.mark === "hit" || c.mark === "below") && (
                <span className="text-xs font-medium">{formatAmount(c.amount, unit)}</span>
              )}
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-3.5 text-[12.5px] text-ink-2">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="size-3 rounded-[3px] bg-brand" />
          {legend.hit}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="size-3 rounded-[3px] border border-[#B9CBE6] bg-cell" />
          {legend.below}
        </span>
        {legend.missing && (
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="size-3 rounded-[3px] border border-dashed border-line" />
            {legend.missing}
          </span>
        )}
      </div>
    </section>
  );
}
