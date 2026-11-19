import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { validateDailyRows, validateTargetRows, type ImportLookup } from "@/domain/import/rows";
import { LIMITS, buildTemplate, readSheet } from "./xlsx";

type Cell = ExcelJS.CellValue;

async function book(fill: (sheet: ExcelJS.Worksheet) => void): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  fill(wb.addWorksheet("data"));
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}
const rowsOf = async (data: ArrayBuffer, kind: "targets" | "daily" = "daily") => {
  const r = await readSheet(data, kind);
  if (!r.ok) throw new Error(`read failed: ${r.error}`);
  return r.rows;
};
const endRecord = (view: DataView): number => {
  for (let i = view.byteLength - 22; i >= 0; i--) if (view.getUint32(i, true) === 0x06054b50) return i;
  throw new Error("no end record");
};
const toArrayBuffer = (u: Uint8Array) => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;

describe("readSheet", () => {
  it("reads Arabic headers, skips blank rows, keeps Date cells and Arabic-Indic text", async () => {
    const data = await book((s) => {
      s.addRow(["اسم المستخدم", "التاريخ", "الخط", "المبلغ"]);
      s.addRow(["ahmed", new Date(Date.UTC(2026, 10, 12)), "bev", "١٢٠"]);
      s.addRow([]);
      s.addRow(["khaled", "2026-11-11", "food", 7200]);
    });
    const rows = await rowsOf(data);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      row: 2,
      cells: { login: "ahmed", date: new Date(Date.UTC(2026, 10, 12)), line: "bev", amount: "١٢٠" },
    });
    expect(rows[1]!.row).toBe(4);
    const lookup: ImportLookup & { today: string; isSellingDay: () => boolean } = {
      reps: new Map([["ahmed", "u1"], ["khaled", "u2"]]),
      lines: new Map([["bev", { id: "b", unit: "cases", kind: "sales" }], ["food", { id: "f", unit: "value", kind: "sales" }]]),
      today: "2026-11-14",
      isSellingDay: () => true,
    };
    const out = validateDailyRows(rows, lookup);
    expect(out.errors).toEqual([]);
    expect(out.ops.map((o) => [o.date, o.amount])).toEqual([["2026-11-12", 120], ["2026-11-11", 720000]]);
  });

  it("matches headers case-insensitively with surrounding spaces", async () => {
    const data = await book((s) => {
      s.addRow([" LOGIN ", "Year", "MONTH", "Line", " الكمية"]);
      s.addRow(["ahmed", 2026, 11, "bev", 5]);
    });
    expect(await rowsOf(data, "targets")).toHaveLength(1);
  });

  it("a UTF-8 text file renamed .xlsx is not_xlsx", async () => {
    const text = new TextEncoder().encode("login,date,line,amount\nahmed,2026-11-12,bev,1\n");
    expect(await readSheet(toArrayBuffer(text), "daily")).toEqual({ ok: false, error: "not_xlsx" });
    expect(await readSheet(new ArrayBuffer(0), "daily")).toEqual({ ok: false, error: "not_xlsx" });
  });

  it("a missing amount column is missing_columns", async () => {
    const data = await book((s) => {
      s.addRow(["login", "date", "line"]);
      s.addRow(["ahmed", "2026-11-12", "bev"]);
    });
    expect(await readSheet(data, "daily")).toEqual({ ok: false, error: "missing_columns", missing: ["amount"] });
  });

  it("an empty sheet is empty", async () => {
    expect(await readSheet(await book(() => undefined), "daily")).toEqual({ ok: false, error: "empty" });
  });

  it("the template reads back ok with zero rows, for both kinds", async () => {
    const lines = [{ code: "bev", nameAr: "مشروبات", unit: "cases" as const }];
    for (const kind of ["targets", "daily"] as const) {
      const buf = await buildTemplate(kind, lines);
      expect(await readSheet(toArrayBuffer(new Uint8Array(buf)), kind)).toEqual({ ok: true, rows: [] });
    }
  });

  it("the template's second sheet lists the lines", async () => {
    const buf = await buildTemplate("daily", [{ code: "bev", nameAr: "مشروبات", unit: "cases" }]);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    expect(wb.worksheets[0]!.getRow(1).values).toEqual([undefined, "login", "date", "line", "amount"]);
    const ref = wb.getWorksheet("الخطوط")!;
    expect(ref.getRow(2).values).toEqual([undefined, "bev", "مشروبات", "cases"]);
  });
});

describe("readSheet with hostile input", () => {
  it("5,001 data rows are read (one over the limit) and the validator reports too_many_rows", async () => {
    const data = await book((s) => {
      s.addRow(["login", "date", "line", "amount"]);
      for (let i = 0; i < 6000; i++) s.addRow(["ahmed", "2026-11-12", "bev", i]);
    });
    const rows = await rowsOf(data);
    expect(rows).toHaveLength(LIMITS.dataRows);
    const lookup = { reps: new Map(), lines: new Map(), today: "2026-11-14", isSellingDay: () => true };
    expect(validateDailyRows(rows, lookup).errors).toEqual([{ row: 0, code: "too_many_rows" }]);
  });

  it("a sheet declaring a million rows is too_large without iterating it", async () => {
    const data = await book((s) => {
      s.addRow(["login", "date", "line", "amount"]);
      s.getCell("A1000000").value = "x";
    });
    expect(await readSheet(data, "daily")).toEqual({ ok: false, error: "too_large" });
  });

  it("a file over the size limit is too_large", async () => {
    expect(await readSheet(new ArrayBuffer(LIMITS.fileBytes + 1), "daily")).toEqual({ ok: false, error: "too_large" });
  });

  it("a zip declaring a huge uncompressed size is rejected", async () => {
    const data = await book((s) => {
      s.addRow(["login", "date", "line", "amount"]);
    });
    const bytes = new Uint8Array(data.slice(0));
    const view = new DataView(bytes.buffer);
    const eocd = endRecord(view);
    const cd = view.getUint32(eocd + 16, true);
    view.setUint32(cd + 24, 0x7fffffff, true);
    expect(await readSheet(toArrayBuffer(bytes), "daily")).toEqual({ ok: false, error: "too_large" });
  });

  it("a zip with a bad central directory is not_xlsx", async () => {
    const data = await book((s) => {
      s.addRow(["login", "date", "line", "amount"]);
    });
    const bytes = new Uint8Array(data.slice(0));
    const view = new DataView(bytes.buffer);
    const eocd = endRecord(view);
    const cd = view.getUint32(eocd + 16, true);
    view.setUint32(cd, 0xdeadbeef, true);
    expect(await readSheet(toArrayBuffer(bytes), "daily")).toEqual({ ok: false, error: "not_xlsx" });
    const pointer = new Uint8Array(data.slice(0));
    new DataView(pointer.buffer).setUint32(eocd + 16, 0xfffffff0, true);
    expect(await readSheet(toArrayBuffer(pointer), "daily")).toEqual({ ok: false, error: "not_xlsx" });
    const truncated = new Uint8Array(data.slice(0, bytes.length - 30));
    expect(await readSheet(toArrayBuffer(truncated), "daily")).toEqual({ ok: false, error: "not_xlsx" });
  });

  it("a directory that lies about a size fails to parse, not to exhaust memory", async () => {
    const data = await book((s) => {
      s.addRow(["login", "date", "line", "amount"]);
      for (let i = 0; i < 50; i++) s.addRow(["ahmed", "2026-11-12", "bev", i]);
    });
    const bytes = new Uint8Array(data.slice(0));
    const view = new DataView(bytes.buffer);
    const eocd = endRecord(view);
    const cd = view.getUint32(eocd + 16, true);
    const entries = view.getUint16(eocd + 10, true);
    let pos = cd;
    for (let n = 0; n < entries; n++) {
      view.setUint32(pos + 24, 5, true);
      pos += 46 + view.getUint16(pos + 28, true) + view.getUint16(pos + 30, true) + view.getUint16(pos + 32, true);
    }
    const r = await readSheet(toArrayBuffer(bytes), "daily");
    expect(r.ok).toBe(false);
  });

  it("duplicate headers, including aliases of one name, are rejected as duplicate_columns", async () => {
    const same = await book((s) => {
      s.addRow(["login", "date", "line", "amount", "login"]);
      s.addRow(["ahmed", "2026-11-12", "bev", 5, "third"]);
    });
    expect(await readSheet(same, "daily")).toEqual({ ok: false, error: "duplicate_columns", duplicates: ["login"] });
    const alias = await book((s) => {
      s.addRow(["login", "اسم المستخدم", "date", "line", "amount", "المبلغ"]);
    });
    expect(await readSheet(alias, "daily")).toEqual({ ok: false, error: "duplicate_columns", duplicates: ["login", "amount"] });
  });

  it("headers with RLM, ZWSP, NBSP and a BOM still match", async () => {
    const data = await book((s) => {
      s.addRow(["\uFEFFاسم\u200F\u00A0المستخدم", "\u200Bالتاريخ", "الخط\u200E", "\u00A0المبلغ\u00A0"]);
      s.addRow(["ahmed", "2026-11-12", "bev", 5]);
    });
    expect(await rowsOf(data)).toHaveLength(1);
  });

  it("a date1904 workbook and Date cells with a time part read as their UTC date", async () => {
    const wb = new ExcelJS.Workbook();
    wb.properties.date1904 = true;
    const sh = wb.addWorksheet("data");
    sh.addRow(["login", "date", "line", "amount"]);
    sh.addRow(["ahmed", new Date(Date.UTC(2026, 10, 12, 23, 59, 30)), "bev", 1]);
    sh.addRow(["ahmed", new Date(Date.UTC(2026, 10, 13, 0, 1)), "bev", 1]);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const rows = await rowsOf(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
    const iso = rows.map((r) => (r.cells.date as Date).toISOString().slice(0, 10));
    expect(iso).toEqual(["2026-11-12", "2026-11-13"]);
  });

  it("formulas give their cached result, rich text and hyperlinks their text, errors become error values", async () => {
    const data = await book((s) => {
      s.addRow(["login", "date", "line", "amount"]);
      const r = s.addRow([null, "2026-11-12", null, null]);
      r.getCell(1).value = { richText: [{ text: "ah" }, { text: "med" }] } as Cell;
      r.getCell(3).value = { text: "bev", hyperlink: "https://example.com" } as Cell;
      r.getCell(4).value = { formula: "SUM(1,2)+1000", result: 1003 } as Cell;
      const e = s.addRow(["ahmed", "2026-11-11", "bev", null]);
      e.getCell(4).value = { error: "#DIV/0!" } as Cell;
      const f = s.addRow(["ahmed", "2026-11-10", "bev", null]);
      f.getCell(4).value = { formula: "A1+1" } as Cell;
    });
    const rows = await rowsOf(data);
    expect(rows[0]!.cells).toEqual({ login: "ahmed", date: "2026-11-12", line: "bev", amount: 1003 });
    expect(rows[1]!.cells.amount).toEqual({ error: "#DIV/0!" });
    expect(rows[2]!.cells.amount).toBeNull();
    const lookup = {
      reps: new Map([["ahmed", "u"]]),
      lines: new Map([["bev", { id: "b", unit: "cases" as const, kind: "sales" as const }]]),
      today: "2026-11-14",
      isSellingDay: () => true,
    };
    const out = validateDailyRows(rows, lookup);
    expect(out.ops).toHaveLength(1);
    expect(out.errors).toEqual([
      { row: 3, column: "amount", code: "invalid_amount" },
      { row: 4, column: "amount", code: "missing" },
    ]);
  });

  it("booleans, objects and 10k-character strings are invalid values, not crashes", async () => {
    const data = await book((s) => {
      s.addRow(["login", "year", "month", "line", "amount"]);
      s.addRow(["ahmed", 2026, 11, "bev", true]);
      s.addRow(["ahmed", 2026, 11, "bev", "7".repeat(10_000)]);
      s.addRow(["x".repeat(10_000), 2026, 11, "bev", 1]);
      const r = s.addRow(["ahmed", 2026, 11, "bev", null]);
      r.getCell(5).value = { weird: "thing" } as unknown as Cell;
    });
    const rows = await rowsOf(data, "targets");
    const lookup = {
      reps: new Map([["ahmed", "u"]]),
      lines: new Map([["bev", { id: "b", unit: "cases" as const, kind: "sales" as const }]]),
    };
    const out = validateTargetRows(rows, lookup);
    expect(out.ops).toEqual([]);
    expect(out.errors.map((e) => e.code)).toEqual(["invalid_amount", "invalid_amount", "unknown_rep", expect.stringMatching(/invalid_amount|missing/)]);
  });
});

describe("readSheet with drawings and hyperlinks in the file", () => {
  it("a workbook with an embedded image and a hyperlink cell still reads", async () => {
    const wb = new ExcelJS.Workbook();
    const sh = wb.addWorksheet("data");
    sh.addRow(["login", "date", "line", "amount"]);
    const r = sh.addRow(["x", "2026-11-12", "bev", 5]);
    r.getCell(1).value = { text: "ahmed", hyperlink: "mailto:ahmed@example.com" } as ExcelJS.CellValue;
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
      "base64",
    );
    const id = wb.addImage({ buffer: png as unknown as ExcelJS.Buffer, extension: "png" });
    sh.addImage(id, "F2:G4");
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const rows = await rowsOf(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
    expect(rows[0]!.cells.login).toBe("ahmed");
  });
});
