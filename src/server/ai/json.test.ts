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
});
