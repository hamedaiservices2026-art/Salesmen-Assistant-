// Generates the two sample report images used by `pnpm e2e:ai` (scripts/fixtures/report-640.jpg and
// report-641.jpg). The fake AI provider chooses its canned report by image WIDTH (see
// src/server/ai/fake.ts), so the two files differ only in width. The files are committed; run
// `node scripts/make-fixtures.mjs` only to regenerate them. Synthetic: no real report, no real names.
import { mkdirSync, writeFileSync } from "node:fs";
import sharp from "sharp";

const out = new URL("./fixtures/", import.meta.url);
mkdirSync(out, { recursive: true });

for (const width of [640, 641]) {
  const height = 480;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect width="100%" height="100%" fill="#b8b8b8"/>
    <text x="${width / 2}" y="${height / 2}" font-family="sans-serif" font-size="44" font-weight="bold" text-anchor="middle" fill="#222">SAMPLE REPORT</text>
  </svg>`;
  const jpeg = await sharp(Buffer.from(svg)).jpeg({ quality: 60 }).toBuffer();
  if (jpeg.length >= 20_000) throw new Error(`report-${width}.jpg is ${jpeg.length} bytes, expected under 20 KB`);
  writeFileSync(new URL(`report-${width}.jpg`, out), jpeg);
  console.log(`report-${width}.jpg ${width}x${height} ${jpeg.length} bytes`);
}
