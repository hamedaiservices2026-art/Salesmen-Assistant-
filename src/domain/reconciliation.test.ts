import { describe, expect, it } from "vitest";
import { reconcile } from "./reconciliation";

describe("reconcile", () => {
  it("computes cash and stock", () => {
    expect(
      reconcile({ cashSales: 1480000, collections: 1950000, expenses: 15000, loaded: 160, sold: 118, returned: 3 }),
    ).toEqual({ cashToHandOver: 3415000, stockLeft: 45, warnings: [] });
  });
  it("warns on negative cash", () => {
    const r = reconcile({ cashSales: 1000, collections: 0, expenses: 5000, loaded: 10, sold: 5, returned: 0 });
    expect(r.cashToHandOver).toBe(-4000);
    expect(r.warnings).toEqual(["negative_cash"]);
  });
  it("warns on negative stock", () => {
    const r = reconcile({ cashSales: 0, collections: 0, expenses: 0, loaded: 10, sold: 12, returned: 0 });
    expect(r.stockLeft).toBe(-2);
    expect(r.warnings).toEqual(["negative_stock"]);
  });
});
