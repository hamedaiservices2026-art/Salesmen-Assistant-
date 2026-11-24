import { describe, expect, it } from "vitest";
import { AUDIO_MAX_BYTES, AUDIO_MAX_SECONDS, sniffAudio, TRANSCRIPT_MAX } from "./audio";

const bytes = (...b: number[]) => new Uint8Array(b);
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const ftyp = (brand: string) => bytes(0, 0, 0, 0x20, ...ascii("ftyp"), ...ascii(brand), 0, 0, 0, 0);

describe("audio limits", () => {
  it("has the plan's values", () => {
    expect(AUDIO_MAX_BYTES).toBe(3_000_000);
    expect(AUDIO_MAX_SECONDS).toBe(60);
    expect(TRANSCRIPT_MAX).toBe(2000);
  });
});

describe("sniffAudio", () => {
  it("WebM / Matroska", () => expect(sniffAudio(bytes(0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3))).toBe("audio/webm"));
  it("MP4 family brands", () => {
    for (const b of ["M4A ", "isom", "mp42", "mp41", "iso2", "M4B ", "dash", "3gp4"]) expect(sniffAudio(ftyp(b))).toBe("audio/mp4");
  });
  it("Ogg", () => expect(sniffAudio(bytes(...ascii("OggS"), 0, 2))).toBe("audio/ogg"));
  it("refuses image brands in an ftyp box", () => {
    for (const b of ["heic", "heix", "hevc", "mif1", "msf1", "avif", "avis"]) expect(sniffAudio(ftyp(b))).toBeNull();
  });
  it("refuses everything else", () => {
    expect(sniffAudio(bytes(...ascii("<html>")))).toBeNull();
    expect(sniffAudio(bytes(0xff, 0xd8, 0xff, 0xe0))).toBeNull();
    expect(sniffAudio(bytes(...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WAVE")))).toBeNull();
    expect(sniffAudio(bytes(...ascii("ID3")))).toBeNull();
    expect(sniffAudio(new Uint8Array())).toBeNull();
    expect(sniffAudio(bytes(0x1a, 0x45, 0xdf))).toBeNull();
    expect(sniffAudio(bytes(0, 0, 0, 0x20, ...ascii("ftyp")))).toBeNull(); // no brand
    expect(sniffAudio(bytes(0, 0, 0, 0x20, ...ascii("ftyx"), ...ascii("isom")))).toBeNull();
  });
});
