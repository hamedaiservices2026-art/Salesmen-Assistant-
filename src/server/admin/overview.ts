import { and, eq, inArray, lte, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import * as s from "@/db/schema";
import { dayCounts, type ISODate } from "@/domain/calendar";
import type { SchemeInput } from "@/domain/commission";
import { lineName, type LineKind } from "@/domain/lines";
import type { Unit } from "@/domain/money";
import {
  closestToWin,
  onPaceCounts,
  sortByDistance,
  teamLine,
  type RepLine,
  type RepStanding,
  type TeamLine,
} from "@/domain/team";
import { assertRole } from "@/server/auth/roles";
import type { Ctx } from "@/server/ctx";
import { getCompanyPrefs } from "@/server/repos/company";
import { loadCalendar, loadLines, loadScheme } from "@/server/repos/month-data";
import { getMonthView, type MonthView } from "@/server/repos/month-view";
import { repCtx } from "./rep-ctx";
import { listIncentives } from "./incentives";
import { listUploads } from "./uploads";

/**
 * Reps read at a time. Each rep costs one `getMonthView` (about nine queries); a page render holds
 * at most this many in flight so one overview cannot take more than a few connections of the
 * database pool, which other requests share. A company's overview is O(reps) queries.
 */
export const REP_CHUNK = 4;

export type OverviewIncentive = {
  componentId: string;
  label: string;
  amount: number;
  endsOn: ISODate;
  seen: number;
  notified: number;
  /** `unit` is the unit of both figures (a value line holds halalas). */
  closest: { name: string; achieved: number; needed: number; unit: Unit } | null;
};

export type Overview = {
  counts: { total: number; elapsed: number; left: number };
  /** The selling-day number of today: selling days before it, plus one when today sells. */
  dayNumber: number;
  todaySelling: boolean;
  lines: { lineId: string; name: string; unit: Unit; kind: LineKind }[];
  reps: RepStanding[];
  team: TeamLine[];
  onPace: { ahead: number; slightly: number; behind: number; total: number };
  closedToday: number;
  incentives: OverviewIncentive[];
  lastUpload: { filename: string; createdAt: Date; rows: number; errorCount: number; applied: boolean } | null;
};

function standingLines(view: MonthView): RepLine[] {
  return view.lines.map((l) => ({
    lineId: l.lineId,
    target: l.target,
    achieved: l.achieved,
    expected: l.pace.expected,
    pct: l.pace.pct,
    status: l.pace.status,
    held: l.kind === "coverage",
  }));
}

function inputOf(view: MonthView): SchemeInput {
  return {
    lines: Object.fromEntries(
      view.lines.map((l) => [l.lineId, { target: l.target, achieved: l.achieved, ...(l.kind === "coverage" ? { hold: true } : {}) }]),
    ),
    focus: Object.fromEntries(view.focus.map((f) => [f.id, { achieved: f.achieved }])),
  };
}

/**
 * The admin's team overview for one month. Every rep's figures come from `getMonthView` on his own
 * context (`repCtx`), so they equal what he sees. The population is the company's active reps plus
 * active supervisors who hold a target in the month (R21); other supervisors are not listed.
 */
export async function getOverview(ctx: Ctx, opts: { year: number; month: number; today: ISODate }): Promise<Overview> {
  assertRole(ctx, ["admin"]);
  const { year, month, today } = opts;
  const sup = alias(s.users, "supervisor");
  const [prefs, cal, lineRows, repRows, scheme] = await Promise.all([
    getCompanyPrefs(ctx),
    loadCalendar(ctx, year, month),
    loadLines(ctx),
    ctx.db
      .select({ id: s.users.id, name: s.users.name, role: s.users.role, supervisorName: sup.name })
      .from(s.users)
      .leftJoin(sup, and(eq(sup.id, s.users.supervisorId), eq(sup.companyId, ctx.companyId)))
      .where(
        and(
          eq(s.users.companyId, ctx.companyId),
          eq(s.users.active, true),
          or(
            eq(s.users.role, "rep"),
            // A supervisor who holds a target in the month is a seller too (R21).
            and(
              eq(s.users.role, "supervisor"),
              inArray(
                s.users.id,
                ctx.db
                  .select({ id: s.targets.userId })
                  .from(s.targets)
                  .where(and(eq(s.targets.companyId, ctx.companyId), eq(s.targets.year, year), eq(s.targets.month, month))),
              ),
            ),
          ),
        ),
      ),
    loadScheme(ctx, year, month),
  ]);
  const counts = dayCounts(cal.selling, today);
  const todaySelling = cal.selling.includes(today);

  const lastClose = new Map<string, ISODate>();
  if (repRows.length > 0) {
    // Confirmed closes only: an upload-created draft leaves the day open.
    const last = await ctx.db
      .select({ userId: s.dailyCloses.userId, date: sql<string>`max(${s.dailyCloses.date})` })
      .from(s.dailyCloses)
      .where(
        and(
          eq(s.dailyCloses.companyId, ctx.companyId),
          eq(s.dailyCloses.status, "confirmed"),
          lte(s.dailyCloses.date, today),
          inArray(s.dailyCloses.userId, repRows.map((r) => r.id)),
        ),
      )
      .groupBy(s.dailyCloses.userId);
    for (const r of last) lastClose.set(r.userId, r.date);
  }

  const standings: RepStanding[] = [];
  const inputs = new Map<string, SchemeInput>();
  const focusUnit = new Map<string, Unit>();
  for (let i = 0; i < repRows.length; i += REP_CHUNK) {
    const chunk = repRows.slice(i, i + REP_CHUNK);
    const done = await Promise.all(
      chunk.map(async (r) => {
        const rc = await repCtx(ctx, r.id);
        if (!rc) return null;
        return { r, view: await getMonthView(rc, { year, month, today }) };
      }),
    );
    for (const d of done) {
      if (!d) continue;
      standings.push({
        repId: d.r.id,
        name: d.r.name,
        supervisorName: d.r.supervisorName,
        isSupervisor: d.r.role === "supervisor",
        lines: standingLines(d.view),
        lastClose: lastClose.get(d.r.id) ?? null,
        closedToday: d.view.hasClosedToday,
      });
      inputs.set(d.r.id, inputOf(d.view));
      for (const f of d.view.focus) focusUnit.set(f.id, f.unit);
    }
  }
  const reps = sortByDistance(standings);

  const team = lineRows
    .map((l) => teamLine(reps, l.lineId, counts, prefs.behindPct))
    .filter((t) => t.target > 0);

  const active = (await listIncentives(ctx, { year, month })).filter((i) => i.startsOn <= today && today <= i.endsOn);
  const incentives: OverviewIncentive[] = active.map((i) => {
    const comp = scheme?.components.find((c) => c.id === i.componentId);
    const win =
      comp?.type === "bonus"
        ? closestToWin(
            comp.condition,
            reps.map((r) => ({ name: r.name, input: inputs.get(r.repId)! })),
          )
        : null;
    let closest: OverviewIncentive["closest"] = null;
    if (win) {
      // The leaf's line or focus item came from these reps' own month views, so its unit is always known.
      const unit =
        (win.lineId !== undefined ? lineRows.find((l) => l.lineId === win.lineId)?.unit : undefined) ??
        (win.focusItemId !== undefined ? focusUnit.get(win.focusItemId) : undefined);
      if (unit === undefined) throw new Error(`no unit for the leaf of ${i.componentId}`);
      closest = { name: win.name, achieved: win.achieved, needed: win.needed, unit };
    }
    return { componentId: i.componentId, label: i.label, amount: i.amount, endsOn: i.endsOn, seen: i.seen, notified: i.notified, closest };
  });

  const [upload] = await listUploads(ctx, { limit: 1 });

  return {
    counts,
    dayNumber: Math.min(counts.total, counts.elapsed + (todaySelling ? 1 : 0)),
    todaySelling,
    lines: lineRows.map((l) => ({ lineId: l.lineId, name: lineName(l, ctx.locale), unit: l.unit, kind: l.kind })),
    reps,
    team,
    onPace: onPaceCounts(reps),
    closedToday: reps.filter((r) => r.closedToday).length,
    incentives,
    lastUpload: upload
      ? { filename: upload.filename, createdAt: upload.createdAt, rows: upload.rows, errorCount: upload.errorCount, applied: upload.applied }
      : null,
  };
}
