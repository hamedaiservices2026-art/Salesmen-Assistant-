// Digits as the product shows them: always Western `0-9` (Global Constraints). Pure.

/** Arabic-Indic (`٠-٩`) and Persian (`۰-۹`) digits made `0-9`; everything else is left as it is. */
export function westernDigits(s: string): string {
  return s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}
