import { describe, expect, it } from "vitest";
import type { Condition, SchemeInput } from "./commission";
import { closestToWin, onPaceCounts, paceDistance, sortByDistance, teamLine, worstStatus, type RepLine, type RepStanding } from "./team";

const line = (over: Partial<RepLine> & Pick<RepLine, "lineId">): RepLine => ({
  target: 100,
  achieved: 0,
  expected: 0,
  pct: 0,
  status: "ahead",
  held: false,
  ...over,
});
const rep = (name: string, lines: RepLine[]): RepStanding => ({
  repId: name,
  name,
  supervisorName: null,
  lines,
  lastClose: null,
  closedToday: false,
});

describe("paceDistance", () => {
  it("is the largest (expected - achieved) / target, compared exactly", () => {
    const d = paceDistance([
      line({ lineId: "a", target: 3, expected: 1, achieved: 0 }), // 1/3
      line({ lineId: "b", target: 1_000_000_007, expected: 333_333_335, achieved: 0 }), // just under 1/3
    ]);
    expect(d).toEqual({ num: 1, den: 3 });
  });
  it("ignores held and no-target lines; no targets gives den 0", () => {
    expect(paceDistance([line({ lineId: "cov", held: true, target: 10, expected: 0, achieved: 0 })])).toEqual({ num: 0, den: 0 });
    expect(paceDistance([line({ lineId: "x", target: 0 })])).toEqual({ num: 0, den: 0 });
  });
  it("a rep with no targets sorts after the farthest-ahead rep", () => {
    const ahead = rep("khaled", [line({ lineId: "bev", target: 100, expected: 40, achieved: 80, status: "ahead" })]);
    const none = rep("amr", []);
    const behind = rep("yousef", [line({ lineId: "bev", target: 100, expected: 40, achieved: 0, status: "behind" })]);
    expect(sortByDistance([none, ahead, behind]).map((r) => r.name)).toEqual(["yousef", "khaled", "amr"]);
  });
  it("breaks ties by name", () => {
    const l = [line({ lineId: "bev", target: 100, expected: 40, achieved: 20 })];
    expect(sortByDistance([rep("b", l), rep("a", l)]).map((r) => r.name)).toEqual(["a", "b"]);
  });
});

describe("worstStatus and coverage", () => {
  it("ranks behind over slightly_behind over ahead; no_target when none", () => {
    expect(worstStatus([line({ lineId: "a", status: "ahead" }), line({ lineId: "b", status: "slightly_behind" })])).toBe("slightly_behind");
    expect(worstStatus([line({ lineId: "a", status: "slightly_behind" }), line({ lineId: "b", status: "behind" })])).toBe("behind");
    expect(worstStatus([line({ lineId: "a", target: 0, status: "no_target" })])).toBe("no_target");
  });
  it("a held coverage line never makes a rep behind, nor counts in distance", () => {
    const lines = [
      line({ lineId: "bev", target: 100, expected: 40, achieved: 50, status: "ahead" }),
      line({ lineId: "cov", held: true, target: 200, achieved: 0, expected: 0, status: "behind" }),
    ];
    expect(worstStatus(lines)).toBe("ahead");
    expect(paceDistance(lines)).toEqual({ num: -10, den: 100 });
    expect(onPaceCounts([rep("a", lines)])).toEqual({ ahead: 1, slightly: 0, behind: 0, total: 1 });
  });
});

describe("teamLine", () => {
  const counts = { total: 26, elapsed: 11, left: 15 };
  it("sums targets and achieved over the reps and paces the sums", () => {
    const reps = [
      rep("a", [line({ lineId: "bev", target: 3000, achieved: 1000 })]),
      rep("b", [line({ lineId: "bev", target: 3000, achieved: 2230 })]),
      rep("c", [line({ lineId: "bev", target: 0, achieved: 999 })]), // no target: not summed
    ];
    expect(teamLine(reps, "bev", counts, 10)).toEqual({
      lineId: "bev",
      target: 6000,
      achieved: 3230,
      expected: 2538,
      pct: 53,
      expectedPct: 42,
      status: "ahead",
      held: false,
    });
  });
  it("sums a held line without pace", () => {
    const reps = [
      rep("a", [line({ lineId: "cov", held: true, target: 100, achieved: 40, status: "no_target" })]),
      rep("b", [line({ lineId: "cov", held: true, target: 50, achieved: 20, status: "no_target" })]),
    ];
    expect(teamLine(reps, "cov", counts, 10)).toMatchObject({ target: 150, achieved: 60, pct: 40, expected: 0, expectedPct: null, status: "no_target", held: true });
  });
});

describe("closestToWin", () => {
  const inp = (bev: number, focus?: number): SchemeInput => ({
    lines: { bev: { target: 1000, achieved: bev } },
    focus: focus === undefined ? {} : { mango: { achieved: focus } },
  });
  const cond: Condition = { kind: "line_pct_at_least", lineId: "bev", minPct: 100 };
  it("picks the highest progress among those who have not won, ties by name", () => {
    expect(
      closestToWin(cond, [
        { name: "b", input: inp(900) },
        { name: "a", input: inp(900) },
        { name: "c", input: inp(1000) }, // already won
        { name: "d", input: inp(100) },
      ]),
    ).toEqual({ name: "a", achieved: 900, needed: 1000, lineId: "bev" });
  });
  it("is null when everybody won or nobody can", () => {
    expect(closestToWin(cond, [{ name: "c", input: inp(1000) }])).toBeNull();
    expect(closestToWin({ kind: "focus_at_least", focusItemId: "mango", min: 10 }, [{ name: "x", input: inp(5) }])).toBeNull();
    expect(closestToWin(cond, [])).toBeNull();
  });
  it("uses the weakest leaf of an all condition", () => {
    const all: Condition = {
      kind: "all",
      conditions: [
        { kind: "line_pct_at_least", lineId: "bev", minPct: 100 },
        { kind: "focus_at_least", focusItemId: "mango", min: 10 },
      ],
    };
    expect(closestToWin(all, [{ name: "x", input: inp(900, 2) }])).toEqual({ name: "x", achieved: 2, needed: 10, focusItemId: "mango" });
  });
});
