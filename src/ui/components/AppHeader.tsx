import Link from "next/link";
import { Settings } from "lucide-react";
import { NotificationBell } from "./NotificationBell";

/** Brand-blue band: greeting, date line, notifications bell, then the line tabs. */
export function AppHeader({
  greeting,
  dateLine,
  notificationsLabel,
  settingsLabel,
  children,
}: {
  greeting: string;
  dateLine?: string;
  notificationsLabel: string;
  /** When given, a gear link to the settings screen shows next to the bell. */
  settingsLabel?: string;
  children?: React.ReactNode;
}) {
  return (
    <header className="flex flex-col gap-3.5 bg-brand px-5 py-4 text-white">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h1 className="m-0 text-[18px] font-bold">{greeting}</h1>
          {dateLine && <p className="m-0 text-[12.5px] text-on-brand-2">{dateLine}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {settingsLabel && (
            <Link
              href="/app/settings"
              aria-label={settingsLabel}
              className="flex size-11 items-center justify-center rounded-xl bg-white/14 text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            >
              <Settings aria-hidden="true" size={22} strokeWidth={1.8} />
            </Link>
          )}
          <NotificationBell label={notificationsLabel} />
        </div>
      </div>
      {children}
    </header>
  );
}
