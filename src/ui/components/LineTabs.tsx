import Link from "next/link";

export type LineTab = { id: string; name: string; pct: string };

/** One tab per target line; the selected line is white with blue text. Selection is the `line` URL parameter. */
export function LineTabs({ lines, selectedId, label }: { lines: LineTab[]; selectedId: string; label: string }) {
  return (
    <nav aria-label={label} className="grid grid-cols-3 gap-1.5">
      {lines.map((l) => {
        const selected = l.id === selectedId;
        return (
          <Link
            key={l.id}
            href={`/app?line=${encodeURIComponent(l.id)}`}
            replace
            scroll={false}
            aria-current={selected ? "true" : undefined}
            className={
              "flex min-h-[52px] flex-col items-center rounded-[10px] px-1 py-1.5 no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white " +
              (selected ? "bg-white text-brand" : "bg-white/14 text-white")
            }
          >
            <span className={"text-[12.5px] " + (selected ? "font-semibold" : "font-medium")}>{l.name}</span>
            <span className={"text-[17px] leading-[1.2] " + (selected ? "font-extrabold" : "font-bold")}>{l.pct}</span>
          </Link>
        );
      })}
    </nav>
  );
}
