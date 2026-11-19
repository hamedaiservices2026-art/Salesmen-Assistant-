import { deflateRawSync } from "node:zlib";

/** Test-only: a minimal zip writer for hostile files, where every field the reader checks can be lied about. */
export type Entry = {
  name: string;
  content: Uint8Array;
  method?: 0 | 8;
  /** Overrides of what the central directory (or local header) claims. */
  methodField?: number;
  flags?: number;
  declaredSize?: number;
  crc?: number;
  localName?: string;
  /** Precompressed bytes to store instead of compressing `content`. */
  raw?: Uint8Array;
};
export type Archive = {
  comment?: Uint8Array;
  commentLengthField?: number;
  gapBeforeEocd?: number;
  entriesField?: number;
  diskField?: number;
  /** localOffset overrides by entry index. */
  localOffsets?: Record<number, number>;
};

const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
export const crc32 = (b: Uint8Array): number => {
  let c = 0xffffffff;
  for (const x of b) c = TABLE[(c ^ x) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
export const utf8 = (s: string) => new TextEncoder().encode(s);

export function writeZip(entries: Entry[], a: Archive = {}): Uint8Array {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const push = (b: Uint8Array) => {
    parts.push(b);
    offset += b.length;
  };
  entries.forEach((e, i) => {
    const method = e.method ?? 8;
    const data = e.raw ?? (method === 8 ? deflateRawSync(e.content) : e.content);
    const name = utf8(e.name);
    const localName = utf8(e.localName ?? e.name);
    const crc = e.crc ?? crc32(e.content);
    const usize = e.declaredSize ?? e.content.length;
    const local = new Uint8Array(30 + localName.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, e.flags ?? 0, true);
    lv.setUint16(8, e.methodField ?? method, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, usize, true);
    lv.setUint16(26, localName.length, true);
    local.set(localName, 30);
    const localOffset = offset;
    push(local);
    push(data);
    const c = new Uint8Array(46 + name.length);
    const cv = new DataView(c.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, e.flags ?? 0, true);
    cv.setUint16(10, e.methodField ?? method, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, usize, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, a.localOffsets?.[i] ?? localOffset, true);
    c.set(name, 46);
    central.push(c);
  });
  const cdOffset = offset;
  central.forEach(push);
  const cdSize = offset - cdOffset;
  if (a.gapBeforeEocd) push(new Uint8Array(a.gapBeforeEocd).fill(0x41));
  const comment = a.comment ?? new Uint8Array(0);
  const eocd = new Uint8Array(22 + comment.length);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, a.diskField ?? 0, true);
  ev.setUint16(8, a.entriesField ?? entries.length, true);
  ev.setUint16(10, a.entriesField ?? entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, cdOffset, true);
  ev.setUint16(20, a.commentLengthField ?? comment.length, true);
  eocd.set(comment, 22);
  push(eocd);
  const out = new Uint8Array(offset);
  let p = 0;
  for (const b of parts) {
    out.set(b, p);
    p += b.length;
  }
  return out;
}

