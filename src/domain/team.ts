import type { ISODate } from "./calendar";
import type { Condition, SchemeInput } from "./commission";
import { checkLeaf } from "./commission/evaluate";
import { computePace, type PaceStatus } from "./pace";

/**
 * One rep's standing on one line. `held` marks a coverage line: a count as of a date, shown but
 * never ranked (its status is `no_target`, and pace distance, worst status and the on-pace
 * counts all skip it).
 */
export type RepLine = {
  lineId: string;
  target: number;
  achieved: number;
  expected: number;
  pct: number | null;
  status: PaceStatus;
  held: boolean;
};

export type RepStanding = {
  repId: string;
  name: string;
  supervisorName: string | null;
  lines: RepLine[];
  /** Latest confirmed close on or before today; upload-created drafts do not count. */
  lastClose: ISODate | null;
  closedToday: boolean;
};

export type TeamLine = {
  lineId: string;
  target: number;
  achieved: number;
  expected: number;
  pct: number | null;
  expectedPct: number | null;
  status: PaceStatus;
  held: boolean;
};

const rankable = (l: RepLine) => !l.held && l.target > 0;

/**
 * The largest `(expected - achieved) / target` over the rep's targeted, non-held lines, as an exact
 * fraction `{ num, den }` (`den` is the target). A rep with no such line is `{ num: 0, den: 0 }`
 * and sorts after everyone.
 */
export function paceDistance(lines: RepLine[]): { num: number; den: number } {
  let best: { num: number; den: number } | null = null;
  for (const l of lines) {
    if (!rankable(l)) continue;
    const cur = { num: l.expected - l.achieved, den: l.target };
    // cur > best  <=>  cur.num * best.den > best.num * cur.den  (denominators are positive)
    if (best === null || BigInt(cur.num) * BigInt(best.den) > BigInt(best.num) * BigInt(cur.den)) best = cur;
  }
  return best ?? { num: 0, den: 0 };
}

function compareDistance(a: { num: number; den: number }, b: { num: number; den: number }): number {
  if (a.den === 0 || b.den === 0) return a.den === b.den ? 0 : a.den === 0 ? 1 : -1;
  const left = BigInt(a.num) * BigInt(b.den);
  const right = BigInt(b.num) * BigInt(a.den);
  return left === right ? 0 : left > right ? -1 : 1; // the larger distance first
}

/** Farthest behind first; ties and reps without targets by name (code-unit order, so it never depends on the platform's locale data). */
export function sortByDistance(reps: RepStanding[]): RepStanding[] {
  return reps
    .map((r) => ({ r, d: paceDistance(r.lines) }))
    .sort((x, y) => compareDistance(x.d, y.d) || (x.r.name < y.r.name ? -1 : x.r.name > y.r.name ? 1 : 0))
    .map((x) => x.r);
}

const SEVERITY: Record<PaceStatus, number> = { no_target: 0, ahead: 1, slightly_behind: 2, behind: 3 };

/** The worst status over the non-held lines with a target; `no_target` when there is none. */
export function worstStatus(lines: RepLine[]): PaceStatus {
  let worst: PaceStatus = "no_target";
  for (const l of lines) {
    if (!rankable(l) || l.status === "no_target") continue;
    if (SEVERITY[l.status] > SEVERITY[worst]) worst = l.status;
  }
  return worst;
}

/**
 * The team's standing on one line: targets and achieved summed over the reps who hold a target on
 * it, paced like one rep. A held (coverage) line is summed and shown, with no pace.
 */
export function teamLine(
  reps: RepStanding[],
  lineId: string,
  counts: { total: number; elapsed: number; left: number },
  behindPct: number,
): TeamLine {
  let target = 0;
  let achieved = 0;
  let held = false;
  for (const r of reps) {
    const l = r.lines.find((x) => x.lineId === lineId);
    if (!l || l.target <= 0) continue;
    target += l.target;
    achieved += l.achieved;
    held = held || l.held;
  }
  if (held) {
    const pct = target > 0 ? Math.floor((achieved * 100) / target) : null;
    return { lineId, target, achieved, expected: 0, pct, expectedPct: null, status: "no_target", held };
  }
  const p = computePace({ target, achieved, ...counts, behindPct });
  const expectedPct = target > 0 ? Math.floor((p.expected * 100) / target) : null;
  return { lineId, target, achieved, expected: p.expected, pct: p.pct, expectedPct, status: p.status, held };
}

/** How many reps are in each worst-status bucket; reps with no ranked line count only in `total`. */
export function onPaceCounts(reps: RepStanding[]): { ahead: number; slightly: number; behind: number; total: number } {
  const out = { ahead: 0, slightly: 0, behind: 0, total: reps.length };
  for (const r of reps) {
    const w = worstStatus(r.lines);
    if (w === "ahead") out.ahead++;
    else if (w === "slightly_behind") out.slightly++;
    else if (w === "behind") out.behind++;
  }
  return out;
}

/** The rep nearest to a bonus, with the line or focus item his weakest leaf is about (for the unit of the two figures). */
export type ClosestWin = { name: string; achieved: number; needed: number; lineId?: string; focusItemId?: string };

/**
 * Of the reps who can still win a bonus condition, the one nearest to it. A rep's progress is his
 * weakest leaf (achieved / needed); the nearest has the highest progress (exact cross-multiplication,
 * ties by name), and the answer names that rep's weakest leaf. Reps who already meet the condition,
 * hold no target on a line it names, or are not assigned a focus item it names, cannot be chosen.
 * Null when nobody qualifies.
 */
export function closestToWin(
  condition: Condition,
  reps: { name: string; input: SchemeInput }[],
): ClosestWin | null {
  const leaves = condition.kind === "all" ? condition.conditions : [condition];
  let best: ClosestWin | null = null;
  for (const rep of reps) {
    let weakest: { achieved: number; needed: number; lineId?: string; focusItemId?: string } | null = null;
    let eligible = leaves.length > 0;
    for (const leaf of leaves) {
      if (leaf.kind === "focus_at_least" && !(leaf.focusItemId in rep.input.focus)) {
        eligible = false;
        break;
      }
      const part = checkLeaf(leaf, rep.input);
      if (part.needed === null) {
        eligible = false;
        break;
      }
      // achieved / needed, a leaf with needed <= 0 is trivially met
      const ratioLess = (a: { achieved: number; needed: number }, b: { achieved: number; needed: number }) =>
        BigInt(a.achieved) * BigInt(b.needed) < BigInt(b.achieved) * BigInt(a.needed);
      const p = { achieved: part.achieved, needed: part.needed, lineId: part.lineId, focusItemId: part.focusItemId };
      if (p.needed > 0 && (weakest === null || ratioLess(p, weakest))) weakest = p;
    }
    if (!eligible || weakest === null || weakest.achieved >= weakest.needed) continue; // met, or ineligible
    const better =
      best === null ||
      BigInt(weakest.achieved) * BigInt(best.needed) > BigInt(best.achieved) * BigInt(weakest.needed) ||
      (BigInt(weakest.achieved) * BigInt(best.needed) === BigInt(best.achieved) * BigInt(weakest.needed) && rep.name < best.name);
    if (better) {
      best = { name: rep.name, achieved: weakest.achieved, needed: weakest.needed };
      if (weakest.lineId !== undefined) best.lineId = weakest.lineId;
      if (weakest.focusItemId !== undefined) best.focusItemId = weakest.focusItemId;
    }
  }
  return best;
}
