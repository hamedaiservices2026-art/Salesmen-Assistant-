import type { ISODate } from "./calendar";

/** Largest upload accepted, in bytes (Vercel refuses bodies over 4.5 MB). */
export const PHOTO_MAX_BYTES = 4_000_000;
/** Largest decoded image accepted, in pixels (width x height). */
export const PHOTO_MAX_PIXELS = 40_000_000;
/** Longest edge of a stored photo, in pixels. */
export const PHOTO_MAX_EDGE = 1600;

export type FileKind = "report" | "return";
export type ImageType = "jpeg" | "png" | "webp";

const FILE_KINDS: readonly FileKind[] = ["report", "return"];

const startsWith = (head: Uint8Array, at: number, sig: readonly number[]): boolean =>
  head.length >= at + sig.length && sig.every((b, i) => head[at + i] === b);

const JPEG_SIG = [0xff, 0xd8, 0xff];
const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const RIFF_SIG = [0x52, 0x49, 0x46, 0x46]; // "RIFF"
const WEBP_SIG = [0x57, 0x45, 0x42, 0x50]; // "WEBP"

/**
 * The image type from the file's first bytes; the file name and declared type are never used.
 * Only JPEG, PNG and WebP are recognised; everything else (GIF, HEIC, PDF, SVG, HTML, ...) is null.
 */
export function sniffImage(head: Uint8Array): ImageType | null {
  if (startsWith(head, 0, JPEG_SIG)) return "jpeg";
  if (startsWith(head, 0, PNG_SIG)) return "png";
  if (startsWith(head, 0, RIFF_SIG) && startsWith(head, 8, WEBP_SIG)) return "webp";
  return null;
}

const FILE_ID = /^[0-9a-f]{32}$/;
const PATH_PIECE = /^[A-Za-z0-9_-]{1,64}$/;
const DATE_SHAPE = /^(\d{4})-(\d{2})-(\d{2})$/;
const STORAGE_KEY = /^([A-Za-z0-9_-]{1,64})\/([A-Za-z0-9_-]{1,64})\/(\d{4}-\d{2}-\d{2})\/(report|return)-([0-9a-f]{32})\.jpg$/;

export function isFileId(s: string): boolean {
  return typeof s === "string" && FILE_ID.test(s);
}

function isRealDate(iso: string): boolean {
  const m = DATE_SHAPE.exec(iso);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso;
}

/**
 * Where a photo is stored: `company/user/date/kind-id.jpg`. Every piece is checked against a
 * strict pattern, so a key can never hold `..`, a slash inside a piece, or a backslash.
 * The error never repeats the input.
 */
export function storageKey(p: { companyId: string; userId: string; date: ISODate; kind: FileKind; id: string }): string {
  if (typeof p.companyId !== "string" || !PATH_PIECE.test(p.companyId)) throw new Error("storageKey: invalid company id");
  if (typeof p.userId !== "string" || !PATH_PIECE.test(p.userId)) throw new Error("storageKey: invalid user id");
  if (typeof p.date !== "string" || !isRealDate(p.date)) throw new Error("storageKey: invalid date");
  if (!FILE_KINDS.includes(p.kind)) throw new Error("storageKey: invalid kind");
  if (!isFileId(p.id)) throw new Error("storageKey: invalid file id");
  return `${p.companyId}/${p.userId}/${p.date}/${p.kind}-${p.id}.jpg`;
}

/** True only for the exact shape `storageKey` builds (a real date; no `..`, no backslash). */
export function isStorageKey(key: string): boolean {
  if (typeof key !== "string" || key.includes("..") || key.includes("\\")) return false;
  const m = STORAGE_KEY.exec(key);
  return m?.[3] !== undefined && isRealDate(m[3]);
}

/** The size that fits inside `max` x `max`, keeping the ratio; whole pixels; never enlarges. */
export function fitWithin(w: number, h: number, max: number): { w: number; h: number } {
  for (const n of [w, h, max]) {
    if (!Number.isSafeInteger(n) || n < 1) throw new RangeError("fitWithin: sizes must be positive integers");
  }
  const long = Math.max(w, h);
  if (long <= max) return { w, h };
  const scale = (n: number) => Math.max(1, Math.min(max, Math.round((n * max) / long)));
  return w >= h ? { w: max, h: scale(h) } : { w: scale(w), h: max };
}
