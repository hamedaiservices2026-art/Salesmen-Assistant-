import { deflateRawSync } from "node:zlib";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { crc32, utf8, writeZip, type Archive, type Entry } from "./zip-fixtures";
import { readSheet } from "./xlsx";

const ab = (u: Uint8Array) => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;

/** The parts of a real, honest workbook, as plain entries. */
async function honestEntries(rows: unknown[][] = [["ahmed", "2026-11-12", "bev", 5]]): Promise<Entry[]> {
  const wb = new ExcelJS.Workbook();
  const s = wb.addWorksheet("data");
  s.addRow(["login", "date", "line", "amount"]);
  for (const r of rows) s.addRow(r);
  const zip = await JSZip.loadAsync(Buffer.from(await wb.xlsx.writeBuffer()));
  const out: Entry[] = [];
  for (const [name, f] of Object.entries(zip.files)) {
    if (!f.dir) out.push({ name, content: new Uint8Array(await f.async("uint8array")) });
  }
  return out;
}

const NOT_XLSX = { ok: false, error: "not_xlsx" };
const rss = () => process.memoryUsage().rss + process.memoryUsage().arrayBuffers;

describe("hostile zips: the reader is the only parser of attacker bytes", () => {
  it("an honest archive written by the test writer reads", async () => {
    const r = await readSheet(ab(writeZip(await honestEntries())), "daily");
    expect(r).toMatchObject({ ok: true });
    if (r.ok) expect(r.rows).toHaveLength(1);
  });

  it("a real bomb with a lying small declared size is rejected fast without inflating", async () => {
    const entries = await honestEntries();
    const bomb = deflateRawSync(Buffer.alloc(200 * 1024 * 1024));
    expect(bomb.length).toBeLessThan(1_000_000);
    const sheet = entries.findIndex((e) => e.name === "xl/worksheets/sheet1.xml");
    const hostile = entries.map((e, i) =>
      i === sheet ? { ...e, raw: bomb, declaredSize: 4000, crc: crc32(e.content) } : e,
    );
    const bytes = ab(writeZip(hostile));
    const before = rss();
    const t0 = Date.now();
    const r = await readSheet(bytes, "daily");
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(rss() - before).toBeLessThan(100 * 1024 * 1024);
    expect(r).toMatchObject({ ok: false });
  });

  it("a bomb that honestly declares its size is too_large", async () => {
    const entries = await honestEntries();
    const bomb = deflateRawSync(Buffer.alloc(200 * 1024 * 1024));
    const sheet = entries.findIndex((e) => e.name === "xl/worksheets/sheet1.xml");
    const hostile = entries.map((e, i) => (i === sheet ? { ...e, raw: bomb, declaredSize: 200 * 1024 * 1024 } : e));
    expect(await readSheet(ab(writeZip(hostile)), "daily")).toEqual({ ok: false, error: "too_large" });
  });

  it("a bomb inside a dropped entry (xl/media) is never inflated and the workbook still reads", async () => {
    const entries = await honestEntries();
    const bomb = deflateRawSync(Buffer.alloc(200 * 1024 * 1024));
    const withMedia = [...entries, { name: "xl/media/x.bin", content: new Uint8Array(10), raw: bomb, declaredSize: 10 }];
    const before = rss();
    const t0 = Date.now();
    const r = await readSheet(ab(writeZip(withMedia)), "daily");
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(rss() - before).toBeLessThan(100 * 1024 * 1024);
    expect(r).toMatchObject({ ok: true });
  });

  const structural: [string, (e: Entry[]) => [Entry[], Archive]][] = [
    ["EOCD comment length does not match the remaining bytes", (e) => [e, { comment: utf8("hello"), commentLengthField: 2 }]],
    ["a gap between the central directory and the end record", (e) => [e, { gapBeforeEocd: 8 }]],
    ["fewer entries announced than central headers present", (e) => [e, { entriesField: e.length - 1 }]],
    ["more entries announced than central headers present", (e) => [e, { entriesField: e.length + 1 }]],
    ["a zip64 sentinel in the entry count", (e) => [e, { entriesField: 0xffff }]],
    ["a non-zero disk number", (e) => [e, { diskField: 1 }]],
    ["overlapping data spans", (e) => [e, { localOffsets: { 1: 0 } }]],
    ["duplicate entry names", (e) => [[...e, { ...e[0]! }], {}]],
    ["a ../ name", (e) => [[...e, { name: "xl/../evil.xml", content: new Uint8Array(1) }], {}]],
    ["an absolute name", (e) => [[...e, { name: "/etc/passwd", content: new Uint8Array(1) }], {}]],
    ["a backslash name", (e) => [[...e, { name: "xl\\evil.xml", content: new Uint8Array(1) }], {}]],
    ["a NUL in a name", (e) => [[...e, { name: "xl/a\0b.xml", content: new Uint8Array(1) }], {}]],
    ["a local header name that differs from the central one", (e) => [e.map((x, i) => (i === 0 ? { ...x, localName: "other.xml" } : x)), {}]],
    ["an encrypted entry", (e) => [e.map((x, i) => (i === 0 ? { ...x, flags: 1 } : x)), {}]],
    ["compression method 99", (e) => [e.map((x, i) => (i === 0 ? { ...x, methodField: 99 } : x)), {}]],
    ["a stored entry whose sizes differ", (e) => [e.map((x, i) => (i === 0 ? { ...x, method: 0, declaredSize: x.content.length + 5 } : x)), {}]],
    ["a CRC mismatch on a kept entry", (e) => [e.map((x) => (x.name === "xl/worksheets/sheet1.xml" ? { ...x, crc: 1234 } : x)), {}]],
    ["a missing workbook part", (e) => [e.filter((x) => x.name !== "xl/workbook.xml"), {}]],
    ["no worksheet part", (e) => [e.filter((x) => !x.name.startsWith("xl/worksheets/")), {}]],
  ];
  for (const [label, mutate] of structural) {
    it(`rejects ${label} as not_xlsx`, async () => {
      const [entries, archive] = mutate(await honestEntries());
      expect(await readSheet(ab(writeZip(entries, archive)), "daily")).toEqual(NOT_XLSX);
    });
  }

  it("more than 200 entries is too_large", async () => {
    const entries = await honestEntries();
    const many = [...entries, ...Array.from({ length: 200 }, (_, i) => ({ name: `docProps/f${i}.txt`, content: new Uint8Array(1) }))];
    expect(await readSheet(ab(writeZip(many)), "daily")).toEqual({ ok: false, error: "too_large" });
  });

  it("unreferenced parts (theme, docProps, media) are dropped and do not break reading", async () => {
    const entries = await honestEntries();
    const extra = [
      { name: "xl/media/image1.png", content: utf8("not really a png") },
      { name: "xl/externalLinks/externalLink1.xml", content: utf8("<x/>") },
      { name: "xl/vbaProject.bin", content: utf8("macro") },
    ];
    expect(await readSheet(ab(writeZip([...entries, ...extra])), "daily")).toMatchObject({ ok: true });
  });

  it("a sheet of 8 MB of `<drawing` with no `>` is rewritten in linear time", async () => {
    const entries = await honestEntries();
    const evil = utf8("<drawing".repeat(1_048_000));
    const hostile = entries.map((e) => (e.name === "xl/worksheets/sheet1.xml" ? { ...e, content: evil } : e));
    const t0 = Date.now();
    await readSheet(ab(writeZip(hostile)), "daily");
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it("a rels part of 8 MB of `<Relationship` with no `>` is filtered in linear time", async () => {
    const entries = await honestEntries();
    const evil = utf8("<Relationship".repeat(640_000));
    const t0 = Date.now();
    await readSheet(ab(writeZip([...entries, { name: "xl/worksheets/_rels/sheet1.xml.rels", content: evil }])), "daily");
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it("invalid UTF-8 in a sheet is not_xlsx, not silently replaced", async () => {
    const entries = await honestEntries();
    const bad = entries.map((e) =>
      e.name === "xl/worksheets/sheet1.xml" ? { ...e, content: new Uint8Array([...e.content, 0xff, 0xfe]) } : e,
    );
    expect(await readSheet(ab(writeZip(bad)), "daily")).toEqual(NOT_XLSX);
  });

  it("a sheet rels part with no worksheet part is not_xlsx", async () => {
    const entries = (await honestEntries()).filter((e) => !/^xl\/worksheets\/sheet[0-9]+\.xml$/.test(e.name));
    const withRels = [...entries, { name: "xl/worksheets/_rels/sheet1.xml.rels", content: utf8("<Relationships/>") }];
    expect(await readSheet(ab(writeZip(withRels)), "daily")).toEqual(NOT_XLSX);
  });

  it("the sheet XML of all worksheets together is capped at 8 MB", async () => {
    const entries = await honestEntries();
    const filler = new Uint8Array(5 * 1024 * 1024).fill(0x20);
    const two = [...entries, { name: "xl/worksheets/sheet2.xml", content: filler }, { name: "xl/worksheets/sheet3.xml", content: filler }];
    expect(await readSheet(ab(writeZip(two)), "daily")).toEqual({ ok: false, error: "too_large" });
  });

  it("a workbook with an Excel Table reads, rows intact", async () => {
    const wb = new ExcelJS.Workbook();
    const sh = wb.addWorksheet("data");
    sh.addTable({
      name: "T1",
      ref: "A1",
      columns: [{ name: "login" }, { name: "date" }, { name: "line" }, { name: "amount" }],
      rows: [["ahmed", "2026-11-12", "bev", 5], ["khaled", "2026-11-11", "food", 7]],
    });
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const r = await readSheet(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, "daily");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.rows.map((x) => x.cells.login)).toEqual(["ahmed", "khaled"]);
  });
});
