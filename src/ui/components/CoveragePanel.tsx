import Link from "next/link";
import { RefreshCw } from "lucide-react";

/**
 * The home screen's body for a coverage line, in place of the calendar and the today panel: customers
 * covered out of the territory, who last updated it and when, and how many more customers reach the
 * next commission tier. All text arrives translated.
 */
export function CoveragePanel({
  label,
  figures,
  pct,
  lastUpdate,
  need,
  empty,
  updateHref,
  updateLabel,
}: {
  label: string;
  /** "{covered} of {total} customers · {pct}%", or null before the first update. */
  figures: string | null;
  pct: number;
  lastUpdate: string | null;
  need: string | null;
  empty: string;
  updateHref: string;
  updateLabel: string;
}) {
  return (
    <section aria-label={label} className="flex flex-col gap-3.5">
      {figures === null ? (
        <p className="m-0 rounded-xl bg-brand-tint px-4 py-3.5 text-[15px] font-semibold">{empty}</p>
      ) : (
        <div className="flex flex-col gap-2.5 rounded-[14px] border border-line px-4 py-4">
          <p className="m-0 text-[20px] font-extrabold leading-tight">
            <bdi>{figures}</bdi>
          </p>
          <div
            role="progressbar"
            aria-label={label}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.min(100, pct)}
            className="h-2.5 overflow-hidden rounded-full bg-cell"
          >
            <div className="h-full rounded-full bg-brand" style={{ inlineSize: `${Math.min(100, pct)}%` }} />
          </div>
          {lastUpdate && <p className="m-0 text-[13px] text-ink-2">{lastUpdate}</p>}
        </div>
      )}
      {need && <p className="m-0 rounded-xl bg-brand-tint px-4 py-3.5 text-[15px] font-bold">{need}</p>}
      <Link
        href={updateHref}
        className="flex min-h-[52px] items-center justify-center gap-2.5 rounded-xl bg-brand text-base font-bold text-white no-underline hover:bg-brand-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
      >
        <RefreshCw aria-hidden="true" size={22} strokeWidth={1.8} />
        {updateLabel}
      </Link>
    </section>
  );
}
