import { inflateRawSync } from "node:zlib";

export type SafeZipResult =
  | { ok: true; files: Map<string, Uint8Array> }
  | { ok: false; error: "not_xlsx" | "too_large" };

/**
 * The real ceiling for an upload. A sheet of 5,000 rows x 20 columns is under ~2 MB of XML, so
 * 8 MB per part and 12 MB in total are generous; nothing larger is ever inflated.
 */
export const ZIP_LIMITS = {
  entries: 200,
  perEntryInflated: 8 * 1024 * 1024,
  /** All worksheet parts together: exceljs materialises them, so this bounds its heap (about 300 MB at the cap). */
  sheetsInflated: 8 * 1024 * 1024,
  totalInflated: 12 * 1024 * 1024,
} as const;

/** The only parts we keep; everything else is skipped without being inflated. */
const KEPT = new Set([
  "[Content_Types].xml",
  "_rels/.rels",
  "xl/workbook.xml",
  "xl/_rels/workbook.xml.rels",
  "xl/sharedStrings.xml",
  "xl/styles.xml",
]);
const SHEET_RELS = /^xl\/worksheets\/_rels\/sheet[0-9]+\.xml\.rels$/;
const isKept = (name: string): boolean =>
  KEPT.has(name) || /^xl\/worksheets\/sheet[0-9]+\.xml$/.test(name) || SHEET_RELS.test(name);

/** Elements of a sheet that point at parts we dropped (their relationship ids would dangle). */
// Every character class excludes `<` as well as `>`: `[^>]*` can run across tags and goes quadratic
// on input such as 8 MB of `<drawing` with no `>`. With `[^<>]*` each match attempt ends at the next tag.
const DANGLING =
  /<(?:drawing|legacyDrawing|legacyDrawingHF|picture)\b[^<>]*\/>|<tableParts\b[^<>]*\/>|<tableParts\b[^<>]*>(?:\s|<tablePart\b[^<>]*\/>)*<\/tableParts>/g;
const UTF8 = new TextDecoder("utf-8", { fatal: true });
const SHEET = /^xl\/worksheets\/sheet[0-9]+\.xml$/;
function withoutDangling(sheet: Uint8Array): Uint8Array {
  return new TextEncoder().encode(UTF8.decode(sheet).replace(DANGLING, ""));
}

/**
 * A sheet's relationships keep only hyperlinks (typed e-mail addresses become hyperlink cells, and
 * the parser needs their targets); drawings, comments and the like point at parts we dropped.
 */
function onlyHyperlinks(rels: Uint8Array): Uint8Array {
  const text = UTF8.decode(rels);
  const kept = (text.match(/<Relationship\b[^<>]*\/>/g) ?? []).filter((r) => /Type="[^"]*\/hyperlink"/.test(r));
  const head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const ns = '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">';
  return new TextEncoder().encode(`${head}${ns}${kept.join("")}</Relationships>`);
}

const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = TABLE[(c ^ b[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const NOT: SafeZipResult = { ok: false, error: "not_xlsx" };
const BIG: SafeZipResult = { ok: false, error: "too_large" };

type Entry = { name: string; method: number; csize: number; usize: number; crc: number; localOffset: number };

function badName(name: string): boolean {
  if (name === "" || name.includes("\0") || name.includes("\\") || name.startsWith("/") || /^[A-Za-z]:/.test(name)) return true;
  return name.split("/").some((seg) => seg === "..");
}

/**
 * A strict zip reader for untrusted bytes: it accepts only a plain, single-disk, non-zip64 archive
 * whose structure is fully consistent (end record at the very end, central directory ending exactly
 * where it begins, local headers agreeing with it, no overlapping data). It inflates only the parts
 * in the whitelist, each with a hard output cap equal to its declared size (which is itself capped),
 * and checks length and CRC. Anything unusual is `not_xlsx`; anything over a cap is `too_large`.
 * Nothing else ever parses these bytes: the caller rebuilds a clean archive from `files`.
 */
export function readSafeZip(bytes: Uint8Array): SafeZipResult {
  const len = bytes.length;
  if (len < 22) return NOT;
  const view = new DataView(bytes.buffer, bytes.byteOffset, len);
  let eocd = -1;
  for (let i = len - 22; i >= Math.max(0, len - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return NOT;
  if (view.getUint16(eocd + 20, true) !== len - eocd - 22) return NOT;
  const diskNo = view.getUint16(eocd + 4, true);
  const cdDisk = view.getUint16(eocd + 6, true);
  const onDisk = view.getUint16(eocd + 8, true);
  const total = view.getUint16(eocd + 10, true);
  const cdSize = view.getUint32(eocd + 12, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  if (diskNo !== 0 || cdDisk !== 0 || onDisk !== total) return NOT;
  if (total === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff || total === 0) return NOT;
  if (total > ZIP_LIMITS.entries) return BIG;
  if (cdOffset + cdSize !== eocd) return NOT;

  const entries: (Entry & { dataStart: number })[] = [];
  const names = new Set<string>();
  const decoder = new TextDecoder("utf-8");
  let pos = cdOffset;
  for (let n = 0; n < total; n++) {
    if (pos + 46 > eocd || view.getUint32(pos, true) !== 0x02014b50) return NOT;
    const flags = view.getUint16(pos + 8, true);
    const method = view.getUint16(pos + 10, true);
    const crc = view.getUint32(pos + 16, true);
    const csize = view.getUint32(pos + 20, true);
    const usize = view.getUint32(pos + 24, true);
    const nameLen = view.getUint16(pos + 28, true);
    const extraLen = view.getUint16(pos + 30, true);
    const commentLen = view.getUint16(pos + 32, true);
    const diskStart = view.getUint16(pos + 34, true);
    const localOffset = view.getUint32(pos + 42, true);
    const next = pos + 46 + nameLen + extraLen + commentLen;
    if (next > eocd) return NOT;
    if (flags & (0x0001 | 0x0040 | 0x2000)) return NOT;
    if (method !== 0 && method !== 8) return NOT;
    if (diskStart !== 0 || csize === 0xffffffff || usize === 0xffffffff || localOffset === 0xffffffff) return NOT;
    const name = decoder.decode(bytes.subarray(pos + 46, pos + 46 + nameLen));
    if (badName(name) || names.has(name)) return NOT;
    names.add(name);
    if (localOffset + 30 > cdOffset || view.getUint32(localOffset, true) !== 0x04034b50) return NOT;
    const lNameLen = view.getUint16(localOffset + 26, true);
    const lExtraLen = view.getUint16(localOffset + 28, true);
    if (lNameLen !== nameLen) return NOT;
    const dataStart = localOffset + 30 + lNameLen + lExtraLen;
    if (decoder.decode(bytes.subarray(localOffset + 30, localOffset + 30 + lNameLen)) !== name) return NOT;
    if (dataStart + csize > cdOffset) return NOT;
    entries.push({ name, method, csize, usize, crc, localOffset, dataStart });
    pos = next;
  }
  if (pos !== eocd) return NOT;

  const spans = entries.map((e) => [e.localOffset, e.dataStart + e.csize] as const).sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < spans.length; i++) if (spans[i]![0] < spans[i - 1]![1]) return NOT;

  const files = new Map<string, Uint8Array>();
  let inflated = 0;
  let sheets = 0;
  for (const e of entries) {
    if (e.name.endsWith("/") || !isKept(e.name)) continue;
    if (e.usize > ZIP_LIMITS.perEntryInflated) return BIG;
    inflated += e.usize;
    if (SHEET.test(e.name) && (sheets += e.usize) > ZIP_LIMITS.sheetsInflated) return BIG;
    if (inflated > ZIP_LIMITS.totalInflated) return BIG;
    const raw = bytes.subarray(e.dataStart, e.dataStart + e.csize);
    let data: Uint8Array;
    if (e.method === 0) {
      if (e.csize !== e.usize) return NOT;
      data = raw;
    } else {
      try {
        // The cap is the declared size: a stream that inflates past it is lying and is cut off.
        data = inflateRawSync(raw, { maxOutputLength: Math.max(1, e.usize) });
      } catch {
        return NOT;
      }
    }
    if (data.length !== e.usize || crc32(data) !== e.crc) return NOT;
    // The rewrites run after the CRC check, on parts already capped at 8 MB.
    try {
      files.set(e.name, SHEET_RELS.test(e.name) ? onlyHyperlinks(data) : SHEET.test(e.name) ? withoutDangling(data) : data);
    } catch {
      return NOT; // not valid UTF-8
    }
  }
  if (!files.has("xl/workbook.xml") || !files.has("[Content_Types].xml")) return NOT;
  if (![...files.keys()].some((k) => SHEET.test(k))) return NOT;
  return { ok: true, files };
}
