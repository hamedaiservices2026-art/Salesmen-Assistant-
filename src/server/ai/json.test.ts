import { describe, expect, it } from "vitest";
import { parseJsonReply, REPLY_MAX } from "./json";

const FENCE = "```";

describe("parseJsonReply", () => {
  it("reads a reply that is exactly one JSON value", () => {
    expect(parseJsonReply('{"a":1}')).toEqual({ a: 1 });
    expect(parseJsonReply('  \n{"a":1}\n ')).toEqual({ a: 1 });
  });

  it("reads exactly one fenced block", () => {
    expect(parseJsonReply(`${FENCE}json\n{"a":1}\n${FENCE}`)).toEqual({ a: 1 });
    expect(parseJsonReply(`\n${FENCE}\n{"a":1}\n${FENCE}\n`)).toEqual({ a: 1 });
  });

  it("refuses prose around JSON", () => {
    expect(parseJsonReply('{"a":1} thanks')).toBeUndefined();
    expect(parseJsonReply('Sure! {"a":1}')).toBeUndefined();
    expect(parseJsonReply(`Here:\n${FENCE}json\n{"a":1}\n${FENCE}`)).toBeUndefined();
    expect(parseJsonReply(`${FENCE}json\n{"a":1}\n${FENCE} done`)).toBeUndefined();
  });

  it("refuses two fenced blocks and two values", () => {
    expect(parseJsonReply(`${FENCE}json\n{"a":1}\n${FENCE}\n${FENCE}json\n{"b":2}\n${FENCE}`)).toBeUndefined();
    expect(parseJsonReply('{"a":1}{"b":2}')).toBeUndefined();
  });

  it("refuses empty and broken input", () => {
    expect(parseJsonReply("")).toBeUndefined();
    expect(parseJsonReply("   ")).toBeUndefined();
    expect(parseJsonReply("not json")).toBeUndefined();
    expect(parseJsonReply('{"a":')).toBeUndefined();
    expect(parseJsonReply(`${FENCE}json\n${FENCE}`)).toBeUndefined();
  });

  it("refuses input over the cap before parsing", () => {
    const big = `{"a":"${"x".repeat(REPLY_MAX)}"}`;
    expect(big.length).toBeGreaterThan(REPLY_MAX);
    expect(parseJsonReply(big)).toBeUndefined();
    expect(REPLY_MAX).toBe(20_000);
  });

  it("does not throw on deeply nested input", () => {
    expect(() => parseJsonReply("[".repeat(19_000))).not.toThrow();
  });

  it("refuses keys that name prototype machinery, at any depth", () => {
    expect(parseJsonReply('{"__proto__":{"x":1}}')).toBeUndefined();
    expect(parseJsonReply('{"a":{"constructor":{"prototype":{}}}}')).toBeUndefined();
    expect(parseJsonReply('{"constructor":1}')).toBeUndefined();
    expect(parseJsonReply('[{"prototype":"x"}]')).toBeUndefined();
    expect(parseJsonReply(`${FENCE}json\n{"fields":[{"__proto__":1}]}\n${FENCE}`)).toBeUndefined();
    // The words are fine as values.
    expect(parseJsonReply('{"a":"__proto__"}')).toEqual({ a: "__proto__" });
  });

  it("refuses numbers JSON.parse would turn into Infinity", () => {
    expect(parseJsonReply("1e999")).toBeUndefined();
    expect(parseJsonReply('{"a":-1e999}')).toBeUndefined();
    expect(parseJsonReply('{"fields":[{"confidence":1e400}]}')).toBeUndefined();
    expect(parseJsonReply('{"a":1e308}')).toEqual({ a: 1e308 });
  });

  it("keeps the last of duplicate keys (JSON.parse behaviour, documented)", () => {
    expect(parseJsonReply('{"a":1,"a":2}')).toEqual({ a: 2 });
  });
});
