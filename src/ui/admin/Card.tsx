/** White surface on the canvas: 1px line border, 14px radius. */
export function Card({
  title,
  aside,
  children,
  className = "",
  label,
}: {
  title?: string;
  /** Short secondary text on the end side of the title row. */
  aside?: string;
  children: React.ReactNode;
  className?: string;
  /** Accessible name when there is no visible title. */
  label?: string;
}) {
  return (
    <section
      aria-label={title ? undefined : label}
      className={`min-w-0 rounded-[14px] border border-line bg-white ${className}`}
    >
      {title && (
        <div className="flex flex-wrap items-center justify-between gap-2.5 px-5 py-4">
          <h2 className="m-0 text-[17px] font-bold text-ink">{title}</h2>
          {aside && <span className="text-[13px] text-ink-2">{aside}</span>}
        </div>
      )}
      {children}
    </section>
  );
}
