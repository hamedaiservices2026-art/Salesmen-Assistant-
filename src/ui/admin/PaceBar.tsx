import type { PaceStatus } from "@/domain/pace";

const clamp = (n: number) => Math.min(100, Math.max(0, n));

/**
 * A progress bar with the expected position marked in ink. The fill is brand blue on or near pace's
 * good side and red when behind (red only for alerts); with no pace (held or no target) it is muted.
 * `label` is the whole text alternative (achieved, target, expected): the bar itself is an image.
 */
export function PaceBar({
  pct,
  expectedPct,
  status,
  label,
  className = "",
}: {
  pct: number | null;
  expectedPct: number | null;
  status: PaceStatus | "held";
  label: string;
  className?: string;
}) {
  const fill =
    status === "ahead" ? "bg-brand" : status === "behind" || status === "slightly_behind" ? "bg-alert" : "bg-muted";
  return (
    <div role="img" aria-label={label} className={`relative h-2 ${className}`}>
      <div className="h-2 overflow-hidden rounded bg-cell">
        <div className={`h-full ${fill}`} style={{ inlineSize: `${clamp(pct ?? 0)}%` }} />
      </div>
      {expectedPct !== null && (
        <div
          aria-hidden="true"
          data-testid="pace-marker"
          data-pct={clamp(expectedPct)}
          className="absolute -top-1 h-4 w-0.5 bg-ink"
          style={{ insetInlineStart: `calc(${clamp(expectedPct)}% - 1px)` }}
        />
      )}
    </div>
  );
}
