import { Check } from "lucide-react";

/** Full-width brand button, the submit twin of PrimaryLink. */
export function PrimaryButton({ children, disabled }: { children: React.ReactNode; disabled?: boolean }) {
  return (
    <button
      type="submit"
      disabled={disabled}
      className="flex min-h-[52px] items-center justify-center gap-2.5 rounded-xl border-0 bg-brand text-base font-bold text-white hover:bg-brand-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:opacity-60"
    >
      <Check aria-hidden="true" size={22} strokeWidth={2} />
      {children}
    </button>
  );
}
