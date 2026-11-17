"use client";

import { useRef } from "react";
import type { Locale } from "@/i18n/config";
import { LOCALES, LOCALE_ENDONYM } from "@/i18n/config";

/** Language select that saves on change; it sits on the blue sidebar, so it is white on a translucent fill. */
export function LocaleSelect({
  locale,
  label,
  action,
}: {
  locale: Locale;
  label: string;
  action: (form: FormData) => void | Promise<void>;
}) {
  const form = useRef<HTMLFormElement>(null);
  return (
    <form ref={form} action={action}>
      <select
        name="locale"
        aria-label={label}
        defaultValue={locale}
        onChange={() => form.current?.requestSubmit()}
        className="min-h-11 w-full rounded-[10px] border border-white/30 bg-white/14 px-3 text-[14.5px] font-medium text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
      >
        {LOCALES.map((code) => (
          <option key={code} value={code} lang={code} className="text-ink">
            {LOCALE_ENDONYM[code]}
          </option>
        ))}
      </select>
    </form>
  );
}
