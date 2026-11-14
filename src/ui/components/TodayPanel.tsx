/** Blue-tint panel: what to sell today, or the confirmation that today is recorded with tomorrow's need. */
export function TodayPanel({
  label,
  title,
  sub,
  amount,
  unitLabel,
}: {
  label: string;
  title: string;
  sub: string | null;
  amount: string | null;
  unitLabel: string;
}) {
  return (
    <section aria-label={label} className="flex items-center justify-between gap-3 rounded-xl bg-brand-tint px-4 py-3.5">
      <div className="flex min-w-0 flex-col gap-px">
        <h2 className="m-0 text-[15px] font-bold">{title}</h2>
        {sub && <span className="text-[13px] text-ink-2">{sub}</span>}
      </div>
      {amount !== null && (
        <span className="whitespace-nowrap text-[30px] font-extrabold leading-none text-brand">
          {amount} <span className="text-[13px] font-semibold">{unitLabel}</span>
        </span>
      )}
    </section>
  );
}
