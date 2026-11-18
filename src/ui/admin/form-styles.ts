/** Class names shared by the commission editor's form pieces, in the admin's field look. */
export const fieldInput =
  "block min-h-11 w-full rounded-lg border bg-white px-3 text-[15px] text-ink placeholder:text-muted focus:border-brand focus:outline-2 focus:outline-brand disabled:bg-canvas disabled:text-ink-2";
export const fieldOk = "border-line";
export const fieldBad = "border-alert bg-alert-tint";
export const fieldLabel = "mb-1 block text-[13px] font-medium text-ink-2";
export const primaryButton =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-[10px] bg-brand px-5 text-[14.5px] font-semibold text-white hover:bg-brand-hover disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";
export const secondaryButton =
  "inline-flex min-h-11 items-center justify-center gap-1.5 whitespace-nowrap rounded-[10px] border border-line bg-white px-3.5 text-[14px] font-semibold text-brand hover:bg-brand-tint disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";
export const iconButton =
  "inline-flex size-11 shrink-0 items-center justify-center rounded-[10px] border border-line bg-white text-ink-2 hover:bg-brand-tint hover:text-brand disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";

/** What every field component gets to show its own error state. */
export type FieldState = (field: string) => { invalid: boolean; message?: string };
