import { describe, expect, it } from "vitest";
import ar from "./messages/ar.json";
import en from "./messages/en.json";
import ur from "./messages/ur.json";

/** Dotted paths of every leaf (arrays count as leaves with their length). */
function paths(value: unknown, prefix = ""): string[] {
  if (Array.isArray(value)) return [`${prefix}[${value.length}]`];
  if (value !== null && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) => paths(v, prefix ? `${prefix}.${k}` : k));
  }
  return [prefix];
}

describe("message catalogs", () => {
  const base = paths(ar).sort();
  it.each([
    ["en", en],
    ["ur", ur],
  ])("%s has exactly the keys of ar, recursively", (_name, catalog) => {
    expect(paths(catalog).sort()).toEqual(base);
  });
});
