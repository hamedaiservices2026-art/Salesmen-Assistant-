import { describe, expect, it } from "vitest";
import {
  PHOTO_MAX_BYTES,
  PHOTO_MAX_EDGE,
  PHOTO_MAX_PIXELS,
  PHOTO_MAX_SIDE,
  fitWithin,
  isFileId,
  isStorageKey,
  sniffImage,
  storageKey,
} from "./files";

const ascii = (s: string) => new TextEncoder().encode(s);
const ID = "0123456789abcdef0123456789abcdef";

describe("photo limits", () => {
  it("are the plan's exact values", () => {
    expect(PHOTO_MAX_BYTES).toBe(4_000_000);
    expect(PHOTO_MAX_PIXELS).toBe(24_000_000);
    expect(PHOTO_MAX_SIDE).toBe(10_000);
    expect(PHOTO_MAX_EDGE).toBe(1600);
  });
});

describe("sniffImage", () => {
  it("knows JPEG, PNG and WebP from their first bytes", () => {
    expect(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]))).toBe("jpeg");
    expect(sniffImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]))).toBe("png");
    expect(sniffImage(new Uint8Array([...ascii("RIFF"), 1, 2, 3, 4, ...ascii("WEBPVP8 ")]))).toBe("webp");
  });

  it("refuses SVG, HTML, GIF, PDF, HEIC and anything else", () => {
    expect(sniffImage(ascii('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(sniffImage(ascii("<!doctype html><script>alert(1)</script>"))).toBeNull();
    expect(sniffImage(ascii("GIF89a\x01\x00\x01\x00"))).toBeNull();
    expect(sniffImage(ascii("%PDF-1.7\n"))).toBeNull();
    expect(sniffImage(new Uint8Array([0, 0, 0, 0x18, ...ascii("ftypheic"), 0, 0]))).toBeNull();
    expect(sniffImage(new Uint8Array([...ascii("RIFF"), 1, 2, 3, 4, ...ascii("WAVEfmt ")]))).toBeNull();
    expect(sniffImage(new Uint8Array([]))).toBeNull();
  });

  it("needs the whole signature", () => {
    expect(sniffImage(new Uint8Array([0xff, 0xd8]))).toBeNull();
    expect(sniffImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a]))).toBeNull();
    expect(sniffImage(ascii("RIFF1234WEB"))).toBeNull();
  });
});

describe("isFileId", () => {
  it("is 32 lower-case hex characters", () => {
    expect(isFileId(ID)).toBe(true);
    expect(isFileId(ID.slice(1))).toBe(false);
    expect(isFileId(ID.toUpperCase())).toBe(false);
    expect(isFileId(`${ID}0`)).toBe(false);
    expect(isFileId("../../etc/passwd")).toBe(false);
    expect(isFileId(`${ID}\n`)).toBe(false);
  });
});

describe("storageKey", () => {
  const base = { companyId: "demo-co", userId: "ahmed", date: "2026-11-14", kind: "return" as const, id: ID };

  it("builds company/user/date/kind-id.jpg", () => {
    expect(storageKey(base)).toBe("demo-co/ahmed/2026-11-14/return-0123456789abcdef0123456789abcdef.jpg");
    expect(storageKey({ ...base, kind: "report" })).toBe(`demo-co/ahmed/2026-11-14/report-${ID}.jpg`);
  });

  it("throws on a path piece, a bad date or a bad id", () => {
    expect(() => storageKey({ ...base, userId: "../x" })).toThrow();
    expect(() => storageKey({ ...base, companyId: "a/b" })).toThrow();
    expect(() => storageKey({ ...base, companyId: "" })).toThrow();
    expect(() => storageKey({ ...base, userId: "a".repeat(65) })).toThrow();
    expect(() => storageKey({ ...base, userId: "a\\b" })).toThrow();
    expect(() => storageKey({ ...base, date: "2026-02-30" })).toThrow();
    expect(() => storageKey({ ...base, date: "2026-11-14/.." })).toThrow();
    expect(() => storageKey({ ...base, id: "x" })).toThrow();
    expect(() => storageKey({ ...base, kind: "other" as never })).toThrow();
  });

  it("the error does not repeat the bad input", () => {
    expect(() => storageKey({ ...base, userId: "../secret-path" })).toThrow(expect.objectContaining({ message: expect.not.stringContaining("secret-path") }));
  });
});

describe("isStorageKey", () => {
  it("accepts exactly the shape storageKey builds", () => {
    expect(isStorageKey(`demo-co/ahmed/2026-11-14/return-${ID}.jpg`)).toBe(true);
    expect(isStorageKey(`a_b/C-9/2026-01-31/report-${ID}.jpg`)).toBe(true);
  });

  it("refuses traversal, backslashes, other shapes and impossible dates", () => {
    expect(isStorageKey("demo-co/../x.jpg")).toBe(false);
    expect(isStorageKey(`demo-co/ahmed/2026-11-14/return-${ID}.jpg/../../x`)).toBe(false);
    expect(isStorageKey(`../ahmed/2026-11-14/return-${ID}.jpg`)).toBe(false);
    expect(isStorageKey(`demo-co\\ahmed/2026-11-14/return-${ID}.jpg`)).toBe(false);
    expect(isStorageKey(`/demo-co/ahmed/2026-11-14/return-${ID}.jpg`)).toBe(false);
    expect(isStorageKey(`demo-co/ahmed/2026-11-14/return-${ID}.png`)).toBe(false);
    expect(isStorageKey(`demo-co/ahmed/2026-11-14/other-${ID}.jpg`)).toBe(false);
    expect(isStorageKey(`demo-co/ahmed/2026-13-01/return-${ID}.jpg`)).toBe(false);
    expect(isStorageKey(`demo-co/ahmed/2026-11-14/return-${ID}.jpg\n`)).toBe(false);
    expect(isStorageKey(`demo-co//2026-11-14/return-${ID}.jpg`)).toBe(false);
    expect(isStorageKey(`demo-co/ahmed/2026-11-14/return-${ID}.jpg?x=1`)).toBe(false);
    expect(isStorageKey(`demo-co/ahmed/2026-11-14/return-${ID}.jpg%2F..`)).toBe(false);
    expect(isStorageKey(42 as unknown as string)).toBe(false);
  });
});

describe("fitWithin", () => {
  it("scales the long edge down to max, keeping the ratio", () => {
    expect(fitWithin(4000, 3000, 1600)).toEqual({ w: 1600, h: 1200 });
    expect(fitWithin(3000, 4000, 1600)).toEqual({ w: 1200, h: 1600 });
    expect(fitWithin(1601, 1, 1600)).toEqual({ w: 1600, h: 1 });
  });

  it("never enlarges", () => {
    expect(fitWithin(800, 600, 1600)).toEqual({ w: 800, h: 600 });
    expect(fitWithin(1600, 1600, 1600)).toEqual({ w: 1600, h: 1600 });
  });

  it("returns integers", () => {
    const r = fitWithin(3001, 2003, 1600);
    expect(Number.isInteger(r.w) && Number.isInteger(r.h)).toBe(true);
    expect(r.w).toBe(1600);
  });

  it("throws on sizes that are not positive integers", () => {
    expect(() => fitWithin(0, 10, 1600)).toThrow(RangeError);
    expect(() => fitWithin(10.5, 10, 1600)).toThrow(RangeError);
    expect(() => fitWithin(10, 10, 0)).toThrow(RangeError);
  });
});
