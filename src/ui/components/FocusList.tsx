export type FocusRow = { id: string; name: string; detail: React.ReactNode };

/** Focus items the rep should push today. Row detail text is composed by the page. */
export function FocusList({ title, rows }: { title: string; rows: FocusRow[] }) {
  if (rows.length === 0) return null;
  return (
    <section aria-label={title} className="flex flex-col gap-1">
      <h2 className="m-0 text-[15px] font-bold">{title}</h2>
      <ul className="m-0 list-none p-0">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-3 border-b border-line-soft py-[9px] last:border-b-0">
            <span className="text-sm font-semibold">{r.name}</span>
            <span className="whitespace-nowrap text-[13px] text-ink-2">{r.detail}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
