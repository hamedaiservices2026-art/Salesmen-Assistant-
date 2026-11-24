"use client";

import { useId } from "react";
import { Check } from "lucide-react";

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
  notes,
  mark,
  markNote,
  ackLabel,
  ackAria,
  onAcknowledge,
  missingNote,
}: {
  name: string;
  label: string;
  unitLabel?: string;
  mode: "decimal" | "numeric";
  value: string;
  onChange: (value: string) => void;
  error?: string;
  /** Short lines under the field (for example what an admin recorded for it). */
  notes?: string[];
  /** The value came from a photo or voice note: "ai" (read with confidence) or "low" (the rep must check it; R60). */
  mark?: "ai" | "low";
  /** Under the field, what the mark means (for example "from the photo"). */
  markNote?: string;
  /** A "low" mark with these shows a button that says the number is right. */
  ackLabel?: string;
  ackAria?: string;
  onAcknowledge?: () => void;
  /** The draft could not read this required field. */
  missingNote?: string;
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
          aria-describedby={[error ? `${id}-error` : "", mark || missingNote ? `${id}-mark` : ""].filter(Boolean).join(" ") || undefined}
          className={
            "box-border h-12 w-[132px] shrink-0 rounded-[10px] border px-3 text-start text-[17px] font-bold text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand " +
            (error ? "border-alert bg-white" : mark === "low" ? "border-2 border-alert bg-alert-tint" : mark === "ai" ? "border-brand bg-brand-tint" : missingNote ? "border-alert bg-white" : "border-line bg-white")
          }
        />
      </div>
      {(mark || missingNote) && (
        <div id={`${id}-mark`} className="mt-1.5 flex items-center justify-between gap-3">
          <span className={`text-[13px] ${mark === "low" || missingNote ? "font-semibold text-alert" : "text-brand"}`}>
            {mark ? markNote : missingNote}
          </span>
          {mark === "low" && onAcknowledge && ackLabel && (
            <button
              type="button"
              data-ack="pending"
              onClick={onAcknowledge}
              aria-label={ackAria}
              className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-[10px] border border-alert bg-white px-4 text-[15px] font-bold text-alert focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            >
              <Check aria-hidden="true" size={18} strokeWidth={2.2} />
              {ackLabel}
            </button>
          )}
        </div>
      )}
      {notes && notes.length > 0 && (
        <ul className="m-0 mt-1.5 flex list-none flex-col gap-0.5 p-0 text-[13px] text-ink-2">
          {notes.map((n) => (
            <li key={n} dir="auto">
              {n}
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p id={`${id}-error`} className="m-0 mt-1.5 text-[13px] font-semibold text-alert">
          {error}
        </p>
      )}
    </div>
  );
}
