export type Ym = { year: number; month: number };

/** `YYYY-MM` to a year and month, or null when it is not a real month. */
export function parseYm(text: string | undefined): Ym | null {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(text ?? "");
  return m ? { year: Number(m[1]), month: Number(m[2]) } : null;
}

export function formatYm({ year, month }: Ym): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function shiftMonth({ year, month }: Ym, by: number): Ym {
  const index = year * 12 + (month - 1) + by;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}
