export const fieldClass =
  "block min-h-[52px] w-full rounded-lg border border-line bg-white px-4 text-xl text-ink focus:border-brand focus:outline-2 focus:outline-brand";

/** One numeric PIN field: six digits, numeric keypad, never autofilled. */
export function PinField({ name, label }: { name: string; label: string }) {
  return (
    <label className="block">
      <span className="mb-2 block text-base text-ink-2">{label}</span>
      <input
        name={name}
        type="password"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="off"
        maxLength={6}
        required
        dir="ltr"
        className={`${fieldClass} text-center text-3xl tracking-[0.5em]`}
      />
    </label>
  );
}

export function ErrorLine({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-lg bg-alert-tint px-4 py-3 text-base text-alert">
      {message}
    </p>
  );
}

export const buttonClass =
  "min-h-[52px] w-full rounded-lg bg-brand px-4 text-lg font-semibold text-white hover:bg-brand-hover disabled:opacity-60";
