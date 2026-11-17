import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./tokens.css", import.meta.url), "utf8");

describe("design tokens", () => {
  it.each([
    "--color-brand: #0B4EA2",
    "--color-alert: #9B1220",
    "--color-ink: #0E1B2E",
    "--color-cell: #E3ECF8",
    "--color-canvas: #F3F6FA",
  ])("defines %s", (token) => {
    expect(css).toContain(token);
  });
});
