import { describe, expect, it } from "vitest";
import { coverageNeedText, coverageSummary, isolate } from "./coverage-copy";

describe("coverageSummary", () => {
  it("fills the figures and the last-update line, with the name isolated", () => {
    const t = (key: string, v?: Record<string, string | number>) => `${key}:${JSON.stringify(v)}`;
    const s = coverageSummary(t, { covered: 50, total: 120, enteredByName: "سامي" }, "10 نوفمبر");
    expect(s.figures).toBe('figures:{"covered":50,"total":120,"pct":"\u206641%\u2069"}');
    expect(s.lastUpdate).toBe(`lastUpdate:{"date":"10 نوفمبر","name":"${isolate("سامي")}"}`);
  });

  it("keeps the percent sign of the next tier after its digits", () => {
    const t = (key: string, v?: Record<string, string | number>) => `${key}:${JSON.stringify(v)}`;
    expect(coverageNeedText(t, { more: 42, nextPct: 85 })).toBe('need:{"more":42,"nextPct":"\u206685%\u2069"}');
  });
});
