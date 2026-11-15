export type BreakdownRow = { id: string; label: string; sentence: string; amount: string };

/** One row per commission component: the company's label, why it paid what it paid, and the amount. */
export function CommissionBreakdown({
  title,
  label,
  rows,
  unitLabel,
}: {
  title: string;
  label: string;
  rows: BreakdownRow[];
  unitLabel: string;
}) {
  return (
    <section aria-label={label} className="flex flex-col gap-2">
      <h2 className="m-0 text-base font-bold">{title}</h2>
      <ul className="m-0 list-none rounded-[14px] border border-line bg-white p-0">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-3 border-b border-line-soft px-4 py-3 last:border-b-0">
            <div className="flex min-w-0 flex-col gap-px">
              <span className="text-[14.5px] font-semibold">{r.label}</span>
              <span className="text-[13px] text-ink-2">{r.sentence}</span>
            </div>
            <span className="whitespace-nowrap text-base font-bold">
              <bdi dir="ltr">{r.amount}</bdi> <span className="text-[13px] font-medium">{unitLabel}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
