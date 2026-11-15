export type TierCell = { id: string; label: string; pay: string; here: boolean };

/** The tiers of one tiered component; the tier the projection reaches is marked in words as well as colour. */
export function TierTable({
  title,
  cells,
  hereLabel,
}: {
  title: string;
  cells: TierCell[];
  hereLabel: string;
}) {
  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <h2 className="m-0 text-sm font-semibold text-ink-2">{title}</h2>
      <ul className="m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(76px,1fr))] gap-1.5 p-0">
        {cells.map((c) => (
          <li
            key={c.id}
            aria-current={c.here ? "true" : undefined}
            className={
              "box-border flex flex-col items-center gap-0.5 rounded-[10px] px-1 py-2 text-center " +
              (c.here ? "border-2 border-brand bg-brand-tint px-[3px] py-[7px]" : "border border-line bg-white")
            }
          >
            <span className={"text-[12.5px] " + (c.here ? "font-semibold text-brand" : "text-ink-2")}>{c.label}</span>
            {c.here && <span className="text-[12.5px] font-bold text-brand">{hereLabel}</span>}
            <span className={"text-sm font-bold " + (c.here ? "text-brand" : "")}>
              <bdi dir="ltr">{c.pay}</bdi>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
