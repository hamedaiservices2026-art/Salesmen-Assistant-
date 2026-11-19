import { describe, expect, it } from "vitest";
import { sellingDays, type ISODate } from "@/domain/calendar";
import { validateDailyRows, validateTargetRows, type ImportLookup, type RawRow } from "./rows";

const lookup: ImportLookup = {
  reps: new Map([
    ["ahmed", "u-ahmed"],
    ["khaled", "u-khaled"],
  ]),
  lines: new Map([
    ["bev", { id: "l-bev", unit: "cases", kind: "sales" }],
    ["food", { id: "l-food", unit: "value", kind: "sales" }],
    ["cov", { id: "l-cov", unit: "outlets", kind: "coverage" }],
  ]),
};
const weekdays = [6, 0, 1, 2, 3, 4];
const daily = {
  ...lookup,
  today: "2026-11-14",
  isSellingDay: (d: ISODate) => sellingDays(Number(d.slice(0, 4)), Number(d.slice(5, 7)), weekdays, []).includes(d),
};
const r = (row: number, cells: Record<string, unknown>): RawRow => ({ row, cells });

describe("validateTargetRows", () => {
  it("turns rows into operations, parsing by the line's unit", () => {
    const out = validateTargetRows(
      [
        r(2, { login: "ahmed", year: 2026, month: 11, line: "bev", amount: 3200 }),
        r(3, { login: "ahmed", year: "2026", month: "11", line: "food", amount: "8,250.50" }),
      ],
      lookup,
    );
    expect(out.errors).toEqual([]);
    expect(out.ops).toEqual([
      { userId: "u-ahmed", lineId: "l-bev", year: 2026, month: 11, amount: 3200 },
      { userId: "u-ahmed", lineId: "l-food", year: 2026, month: 11, amount: 825050 },
    ]);
  });

  it("trims and lowercases logins and line codes; reads Arabic-Indic digits", () => {
    const out = validateTargetRows([r(2, { login: " AHMED ", year: 2026, month: 11, line: " Bev", amount: "١٢٠" })], lookup);
    expect(out.errors).toEqual([]);
    expect(out.ops[0]).toMatchObject({ userId: "u-ahmed", amount: 120 });
  });

  it("number 8250.5 on a value line is 825050; 12.5 on cases is invalid", () => {
    const out = validateTargetRows(
      [
        r(2, { login: "ahmed", year: 2026, month: 11, line: "food", amount: 8250.5 }),
        r(3, { login: "ahmed", year: 2026, month: 11, line: "bev", amount: 12.5 }),
      ],
      lookup,
    );
    expect(out.ops).toHaveLength(1);
    expect(out.ops[0]!.amount).toBe(825050);
    expect(out.errors).toEqual([{ row: 3, column: "amount", code: "invalid_amount" }]);
  });

  it("reports unknown rep, unknown line, coverage line, bad amount, bad period", () => {
    const out = validateTargetRows(
      [
        r(2, { login: "nobody", year: 2026, month: 11, line: "bev", amount: 1 }),
        r(3, { login: "ahmed", year: 2026, month: 11, line: "zzz", amount: 1 }),
        r(4, { login: "ahmed", year: 2026, month: 11, line: "cov", amount: 1 }),
        r(5, { login: "ahmed", year: 2026, month: 11, line: "bev", amount: "abc" }),
        r(6, { login: "ahmed", year: 2026, month: 13, line: "bev", amount: 1 }),
        r(7, { login: "ahmed", year: 2019, month: 1, line: "bev", amount: 1 }),
        r(8, { login: "ahmed", year: 2026, month: 11, line: "bev" }),
      ],
      lookup,
    );
    expect(out.ops).toEqual([]);
    expect(out.errors).toEqual([
      { row: 2, column: "login", code: "unknown_rep" },
      { row: 3, column: "line", code: "unknown_line" },
      { row: 4, column: "line", code: "coverage_line" },
      { row: 5, column: "amount", code: "invalid_amount" },
      { row: 6, column: "month", code: "invalid_period" },
      { row: 7, column: "year", code: "invalid_period" },
      { row: 8, column: "amount", code: "missing" },
    ]);
  });

  it("a repeated key is a duplicate on the later row only", () => {
    const out = validateTargetRows(
      [
        r(2, { login: "ahmed", year: 2026, month: 11, line: "bev", amount: 1 }),
        r(3, { login: "AHMED", year: 2026, month: 11, line: "bev", amount: 2 }),
        r(4, { login: "ahmed", year: 2026, month: 12, line: "bev", amount: 2 }),
      ],
      lookup,
    );
    expect(out.ops).toHaveLength(2);
    expect(out.errors).toEqual([{ row: 3, code: "duplicate" }]);
  });

  it("skips fully blank rows", () => {
    const out = validateTargetRows(
      [r(2, {}), r(3, { login: "  ", amount: null }), r(4, { login: "ahmed", year: 2026, month: 11, line: "bev", amount: 5 })],
      lookup,
    );
    expect(out.errors).toEqual([]);
    expect(out.ops).toHaveLength(1);
  });

  it("5,001 rows give a single too_many_rows at row 0 and no operations", () => {
    const rows = Array.from({ length: 5001 }, (_, i) =>
      r(i + 2, { login: "ahmed", year: 2026, month: 11, line: "bev", amount: i }),
    );
    expect(validateTargetRows(rows, lookup)).toEqual({ ops: [], errors: [{ row: 0, code: "too_many_rows" }] });
    expect(validateTargetRows(rows.slice(0, 5000), lookup).errors.some((e) => e.code === "too_many_rows")).toBe(false);
  });

  it("hostile cell values are invalid, never a crash", () => {
    const long = "9".repeat(10_000);
    const out = validateTargetRows(
      [
        r(2, { login: "ahmed", year: 2026, month: 11, line: "bev", amount: true }),
        r(3, { login: "ahmed", year: 2026, month: 11, line: "bev", amount: { error: "#DIV/0!" } }),
        r(4, { login: "ahmed", year: 2026, month: 11, line: "bev", amount: long }),
        r(5, { login: long, year: 2026, month: 11, line: "bev", amount: 1 }),
        r(6, { login: { a: 1 }, year: 2026, month: 11, line: "bev", amount: 1 }),
        r(7, { login: "ahmed", year: [1], month: 11, line: "bev", amount: 1 }),
        r(8, { login: "ahmed", year: 2026, month: 11, line: "bev", amount: Number.NaN }),
        r(9, { login: "ahmed", year: 2026, month: 11, line: "bev", amount: 1e21 }),
        r(10, { login: "ahmed", year: 2026, month: 11, line: "bev", amount: -5 }),
      ],
      lookup,
    );
    expect(out.ops).toEqual([]);
    expect(out.errors.map((e) => `${e.row}:${e.code}`)).toEqual([
      "2:invalid_amount",
      "3:invalid_amount",
      "4:invalid_amount",
      "5:unknown_rep",
      "6:unknown_rep",
      "7:invalid_period",
      "8:invalid_amount",
      "9:invalid_amount",
      "10:invalid_amount",
    ]);
  });
});

describe("validateDailyRows", () => {
  it("accepts a selling day up to today and a Date cell", () => {
    const out = validateDailyRows(
      [
        r(2, { login: "ahmed", date: "2026-11-12", line: "bev", amount: 100 }),
        r(3, { login: "khaled", date: new Date(Date.UTC(2026, 10, 12)), line: "food", amount: "7,200" }),
      ],
      daily,
    );
    expect(out.errors).toEqual([]);
    expect(out.ops).toEqual([
      { userId: "u-ahmed", lineId: "l-bev", date: "2026-11-12", amount: 100 },
      { userId: "u-khaled", lineId: "l-food", date: "2026-11-12", amount: 720000 },
    ]);
  });

  it("flags Friday, the future, bad dates, duplicates", () => {
    const out = validateDailyRows(
      [
        r(2, { login: "ahmed", date: "2026-11-13", line: "bev", amount: 1 }),
        r(3, { login: "ahmed", date: "2026-11-15", line: "bev", amount: 1 }),
        r(4, { login: "ahmed", date: "12/11/2026", line: "bev", amount: 1 }),
        r(5, { login: "ahmed", date: "2026-02-30", line: "bev", amount: 1 }),
        r(6, { login: "ahmed", date: "2026-11-12", line: "bev", amount: 1 }),
        r(7, { login: "ahmed", date: "2026-11-12", line: "bev", amount: 2 }),
        r(8, { login: "ahmed", date: new Date(Number.NaN), line: "bev", amount: 2 }),
        r(9, { login: "ahmed", date: 46000, line: "bev", amount: 2 }),
        r(10, { login: "ahmed", date: "2026-11-12", line: "cov", amount: 2 }),
      ],
      daily,
    );
    expect(out.ops).toHaveLength(1);
    expect(out.errors).toEqual([
      { row: 2, column: "date", code: "not_selling_day" },
      { row: 3, column: "date", code: "future_date" },
      { row: 4, column: "date", code: "invalid_date" },
      { row: 5, column: "date", code: "invalid_date" },
      { row: 7, code: "duplicate" },
      { row: 8, column: "date", code: "invalid_date" },
      { row: 9, column: "date", code: "invalid_date" },
      { row: 10, column: "line", code: "coverage_line" },
    ]);
  });

  it("5,001 rows give a single too_many_rows", () => {
    const rows = Array.from({ length: 5001 }, (_, i) => r(i + 2, { login: "ahmed", date: "2026-11-12", line: "bev", amount: i }));
    expect(validateDailyRows(rows, daily).errors).toEqual([{ row: 0, code: "too_many_rows" }]);
  });
});
