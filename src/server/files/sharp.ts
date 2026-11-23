import type SharpModule from "sharp";

type Sharp = typeof SharpModule;

/**
 * Decoders the app never needs. Blocking them means that bytes which slip past a type check can
 * never reach the SVG, PDF, TIFF, HEIF or GIF parsers (R69). `sharp.block` is process-wide.
 */
export const BLOCKED_LOADERS = ["VipsForeignLoadSvg", "VipsForeignLoadPdf", "VipsForeignLoadTiff", "VipsForeignLoadHeif", "VipsForeignLoadGif"];

let loading: Promise<Sharp> | null = null;

/**
 * Loads the native image library on first use (not at import, so modules that never decode an
 * image do not load it) and configures it once: no operation cache (it would keep decoded
 * images of past requests in memory) and the unused decoders blocked.
 */
export function loadSharp(): Promise<Sharp> {
  loading ??= import("sharp").then(
    ({ default: sharp }) => {
      sharp.cache(false);
      sharp.block({ operation: BLOCKED_LOADERS });
      return sharp;
    },
    (e: unknown) => {
      loading = null;
      throw e;
    },
  );
  return loading;
}
