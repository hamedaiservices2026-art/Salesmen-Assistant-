"use client";

import { useId } from "react";

/**
 * One labelled amount row. Always a text input with a decimal or numeric keypad, never
 * `type="number"`, so Arabic-Indic digits and grouping typed by the rep are kept for the parser.
 */
export function AmountField({
  name,
  label,
  unitLabel,
  mode,
  value,
  onChange,
  error,
}: {
  name: string;
  label: string;
  unitLabel?: string;
  mode: "decimal" | "numeric";
  value: string;
  onChange: (value: string) => void;
  error?: string;
}) {
  const id = useId();
  return (
    <div className="border-b border-line-soft py-2.5 last:border-b-0">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-baseline gap-2">
          <label htmlFor={id} className="text-[14.5px] font-medium">
            {label}
          </label>
          {unitLabel && <span className="shrink-0 text-[13px] text-ink-2">{unitLabel}</span>}
        </div>
        <input
          id={id}
          name={name}
          type="text"
          inputMode={mode}
          dir="ltr"
          autoComplete="off"
          enterKeyHint="next"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className={
            "box-border h-12 w-[132px] shrink-0 rounded-[10px] border bg-white px-3 text-start text-[17px] font-bold text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand " +
            (error ? "border-alert" : "border-line")
          }
        />
      </div>
      {error && (
        <p id={`${id}-error`} className="m-0 mt-1.5 text-[13px] font-semibold text-alert">
          {error}
        </p>
      )}
    </div>
  );
}
