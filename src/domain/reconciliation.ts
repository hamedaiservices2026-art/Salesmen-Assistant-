export type ReconciliationWarning = "negative_cash" | "negative_stock";

export function reconcile(i: {
  cashSales: number;
  collections: number;
  expenses: number;
  loaded: number;
  sold: number;
  returned: number;
}): { cashToHandOver: number; stockLeft: number; warnings: ReconciliationWarning[] } {
  const cashToHandOver = i.cashSales + i.collections - i.expenses;
  const stockLeft = i.loaded - i.sold + i.returned;
  const warnings: ReconciliationWarning[] = [];
  if (cashToHandOver < 0) warnings.push("negative_cash");
  if (stockLeft < 0) warnings.push("negative_stock");
  return { cashToHandOver, stockLeft, warnings };
}
