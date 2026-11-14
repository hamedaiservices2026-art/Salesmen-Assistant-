import { Bell } from "lucide-react";

/** Brand-blue band: greeting, date line, static notifications button, then the line tabs. */
export function AppHeader({
  greeting,
  dateLine,
  notificationsLabel,
  children,
}: {
  greeting: string;
  dateLine: string;
  notificationsLabel: string;
  children?: React.ReactNode;
}) {
  return (
    <header className="flex flex-col gap-3.5 bg-brand px-5 py-4 text-white">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h1 className="m-0 text-[18px] font-bold">{greeting}</h1>
          <p className="m-0 text-[12.5px] text-on-brand-2">{dateLine}</p>
        </div>
        <button
          type="button"
          aria-label={notificationsLabel}
          className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-white/14 text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        >
          <Bell aria-hidden="true" size={22} strokeWidth={1.8} />
        </button>
      </div>
      {children}
    </header>
  );
}
