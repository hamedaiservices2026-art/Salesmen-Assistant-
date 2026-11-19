import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import * as s from "@/db/schema";
import type { ISODate } from "@/domain/calendar";
import {
  isISODate,
  referencedFocusIds,
  referencedLineIds,
  validateComponents,
  type Component,
  type Evaluation,
  type NearestWin,
  type SchemeIssue,
  type SchemeRefs,
} from "@/domain/commission";
import { assertRole } from "@/server/auth/roles";
import type { Ctx } from "@/server/ctx";
import { isUniqueViolation } from "@/server/db-errors";
import { commissionViewWith } from "@/server/repos/commission";
import { monthBounds } from "@/server/repos/month-data";
import { repCtx } from "./rep-ctx";
import { updateDraftRow } from "./schemes-internal";

export type Period = { year: number; month: number };

export type SchemeEditor = {
  ok: true;
  schemeId: string | null;
  /** The published version the editor works against; 0 while the month was never published. */
  version: number;
  /** The draft revision the editor works against; send it back with the next save or publish. */
  draftRev: number;
  published: Component[] | null;
  draft: Component[] | null;
  refs: SchemeRefs;
  reps: { id: string; name: string }[];
  /** Newest first; `byName` null for a version published before versions were logged. */
  history: { version: number; at: Date; byName: string | null }[];
  /** What is wrong with the published components today (for example a line deactivated since). */
  issuesInPublished: SchemeIssue[];
};

export type Stale = { ok: false; error: "stale" };
export type SaveDraftResult = { ok: true; draftRev: number } | { ok: false; issues: SchemeIssue[] } | Stale;
export type PublishSchemeResult =
  | { ok: true; version: number }
  | { ok: false; issues: SchemeIssue[] }
  | Stale
  | { ok: false; error: "no_draft" };
export type PublishComponentsResult = { ok: true; version: number } | Stale;
export type PreviewResult =
  | { ok: true; actual: Evaluation; projected: Evaluation; atFullTarget: Evaluation; nearest: NearestWin }
  | { ok: false; issues: SchemeIssue[] }
  | { ok: false; error: "not_found" };

const STALE: Stale = { ok: false, error: "stale" };
const TARGET_ROLES = ["rep", "supervisor"] as const;
/** Scheme data, not interface copy: the name a month's scheme row gets on its first draft. */
const AR_MONTHS = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];

function periodOf(input: { year: unknown; month: unknown }): Period | null {
  const year = input.year;
  const month = input.month;
  if (typeof year !== "number" || !Number.isInteger(year) || year < 2000 || year > 2100) return null;
  if (typeof month !== "number" || !Number.isInteger(month) || month < 1 || month > 12) return null;
  return { year, month };
}

const badPeriod = { ok: false as const, issues: [{ path: "period", code: "shape" as const }] };
const isRev = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n >= 0;

/**
 * What a scheme of the month may name: the company's active lines (in display order), its focus
 * items whose window overlaps the month, and the month's first and last day.
 *
 * With `lock`, the company's lines that those (unvalidated) components name are first locked
 * `FOR UPDATE` in id order, so a line cannot change shape or be deactivated between this read and
 * the end of the caller's transaction; `saveLine` locks the same row and then sees the scheme as in
 * use. Lock order: always by line id (see `moveLine` in `lines.ts`), which keeps two transactions from deadlocking. Call it inside the transaction that writes the scheme.
 */
export async function loadSchemeRefs(db: Db, ctx: Ctx, period: Period, opts: { lock?: unknown } = {}): Promise<SchemeRefs> {
  const { start, end } = monthBounds(period.year, period.month);
  const named = opts.lock === undefined ? [] : referencedLineIds(opts.lock);
  if (named.length > 0) {
    await db
      .select({ id: s.targetLines.id })
      .from(s.targetLines)
      .where(and(eq(s.targetLines.companyId, ctx.companyId), inArray(s.targetLines.id, named)))
      .orderBy(asc(s.targetLines.id))
      .for("update");
  }
  // The focus items they name are locked too (id order, after the lines), so `saveFocusItem`, which
  // locks its row and then reads the published schemes, and a publish take turns.
  const namedFocus = opts.lock === undefined ? [] : referencedFocusIds(opts.lock);
  if (namedFocus.length > 0) {
    await db
      .select({ id: s.focusItems.id })
      .from(s.focusItems)
      .where(and(eq(s.focusItems.companyId, ctx.companyId), inArray(s.focusItems.id, namedFocus)))
      .orderBy(asc(s.focusItems.id))
      .for("update");
  }
  const [lines, focus] = await Promise.all([
    db
      .select({ id: s.targetLines.id, unit: s.targetLines.unit, kind: s.targetLines.kind })
      .from(s.targetLines)
      .where(and(eq(s.targetLines.companyId, ctx.companyId), eq(s.targetLines.active, true)))
      .orderBy(asc(s.targetLines.sort), asc(s.targetLines.id)),
    db
      .select({ id: s.focusItems.id, startsOn: s.focusItems.startsOn, endsOn: s.focusItems.endsOn })
      .from(s.focusItems)
      .where(and(eq(s.focusItems.companyId, ctx.companyId), lte(s.focusItems.startsOn, end), gte(s.focusItems.endsOn, start)))
      .orderBy(asc(s.focusItems.startsOn), asc(s.focusItems.id)),
  ]);
  return { lines, focus, period: { start, end } };
}

async function schemeRowOf(db: Db, ctx: Ctx, period: Period) {
  const [row] = await db
    .select()
    .from(s.schemes)
    .where(and(eq(s.schemes.companyId, ctx.companyId), eq(s.schemes.year, period.year), eq(s.schemes.month, period.month)));
  return row;
}

/** Everything the scheme editor of one month shows. */
export async function getSchemeEditor(ctx: Ctx, input: Period): Promise<SchemeEditor | { ok: false; error: "invalid_period" }> {
  assertRole(ctx, ["admin"]);
  const period = periodOf(input);
  if (!period) return { ok: false, error: "invalid_period" };
  const row = await schemeRowOf(ctx.db, ctx, period);
  const [refs, reps, history] = await Promise.all([
    loadSchemeRefs(ctx.db, ctx, period),
    ctx.db
      .select({ id: s.users.id, name: s.users.name })
      .from(s.users)
      .where(and(eq(s.users.companyId, ctx.companyId), eq(s.users.active, true), inArray(s.users.role, [...TARGET_ROLES])))
      .orderBy(asc(s.users.name), asc(s.users.id)),
    row
      ? ctx.db
          .select({ version: s.schemeVersions.version, at: s.schemeVersions.publishedAt, byName: s.users.name })
          .from(s.schemeVersions)
          .leftJoin(s.users, and(eq(s.users.id, s.schemeVersions.publishedBy), eq(s.users.companyId, ctx.companyId)))
          .where(and(eq(s.schemeVersions.companyId, ctx.companyId), eq(s.schemeVersions.schemeId, row.id)))
          .orderBy(desc(s.schemeVersions.version))
      : Promise.resolve([]),
  ]);
  const published = row?.published ? row.components : null;
  const check = published ? validateComponents(published, refs) : null;
  return {
    ok: true,
    schemeId: row?.id ?? null,
    version: row?.version ?? 0,
    draftRev: row?.draftRev ?? 0,
    published,
    draft: row?.draft ?? null,
    refs,
    reps,
    history,
    issuesInPublished: check && !check.ok ? check.issues : [],
  };
}

/**
 * Stores a valid draft of the month's components. The caller sends the `version` and `draftRev` his
 * editor was loaded with; if either has moved (another admin saved or published), nothing is
 * written and the result is `stale`. The month's row is created on its first save (empty published
 * components, a default name); two first saves at once collide on the row's unique month and the
 * second is `stale`. An invalid draft is not stored: its issues come back to the browser.
 */
export async function saveDraft(
  ctx: Ctx,
  input: Period & { components: unknown; expectedVersion: number; expectedDraftRev: number },
): Promise<SaveDraftResult> {
  assertRole(ctx, ["admin"]);
  const period = periodOf(input);
  if (!period) return badPeriod;
  const { expectedVersion, expectedDraftRev } = input;
  if (!isRev(expectedVersion) || !isRev(expectedDraftRev)) return STALE;

  try {
    return await ctx.db.transaction(async (t) => {
      const tx = t as unknown as Db;
      const row = await schemeRowOf(tx, ctx, period);
      if ((row?.version ?? 0) !== expectedVersion || (row?.draftRev ?? 0) !== expectedDraftRev) return STALE;

      const refs = await loadSchemeRefs(tx, ctx, period, { lock: input.components });
      const checked = validateComponents(input.components, refs);
      if (!checked.ok) return { ok: false as const, issues: checked.issues };

      if (!row) {
        await tx.insert(s.schemes).values({
          id: randomUUID(),
          companyId: ctx.companyId,
          name: `${AR_MONTHS[period.month - 1]} ${period.year}`,
          year: period.year,
          month: period.month,
          components: [],
          published: false,
          draft: checked.components,
          draftRev: 1,
          version: 0,
        });
        return { ok: true as const, draftRev: 1 };
      }
      // Conditional on both counters: a save or publish that committed since the read above makes it miss.
      const saved = await updateDraftRow(tx, ctx, row.id, checked.components, expectedVersion, expectedDraftRev);
      return saved ? { ok: true as const, draftRev: saved.draftRev } : STALE;
    });
  } catch (e) {
    if (isUniqueViolation(e)) return STALE;
    throw e;
  }
}

/**
 * Publishes the month's saved draft: validates it again (its lines locked), then one conditional
 * write through `publishComponents` that also clears the draft. `stale` when the published version
 * or the draft revision differs from the caller's; `no_draft` when there is nothing to publish.
 * From that moment every rep's commission for the month is computed from the new components.
 */
export async function publishScheme(
  ctx: Ctx,
  input: Period & { expectedVersion: number; expectedDraftRev: number },
): Promise<PublishSchemeResult> {
  assertRole(ctx, ["admin"]);
  const period = periodOf(input);
  if (!period) return badPeriod;
  const { expectedVersion, expectedDraftRev } = input;
  if (!isRev(expectedVersion) || !isRev(expectedDraftRev)) return STALE;

  return ctx.db.transaction(async (t) => {
    const tx = t as unknown as Db;
    const row = await schemeRowOf(tx, ctx, period);
    if ((row?.version ?? 0) !== expectedVersion || (row?.draftRev ?? 0) !== expectedDraftRev) return STALE;
    if (!row || row.draft === null) return { ok: false as const, error: "no_draft" as const };

    const refs = await loadSchemeRefs(tx, ctx, period, { lock: row.draft });
    const checked = validateComponents(row.draft, refs);
    if (!checked.ok) return { ok: false as const, issues: checked.issues };
    return publishComponents(tx, ctx, row.id, checked.components, expectedVersion, { clearDraft: true, expectedDraftRev });
  });
}

export type PublishOptions = { clearDraft: false } | { clearDraft: true; expectedDraftRev: number };

/**
 * The one write that publishes components, shared by `publishScheme` and the mid-month incentives:
 * a conditional UPDATE `WHERE version = expectedVersion` (and, when clearing the draft, `draft_rev =
 * expectedDraftRev`) that sets the components, `published`, `version + 1`, `published_at` and
 * `published_by`, then logs the new version in `scheme_versions`. Zero rows updated (another publish
 * got there first, or the id is not the caller's company's) is `stale` and nothing is written.
 *
 * It does not validate: the caller validates `components` in the same transaction against
 * `loadSchemeRefs(tx, ctx, period, { lock: components })`. An open draft is left alone unless
 * `clearDraft` (only `publishScheme`); the version bump already makes that draft stale for its editor.
 */
export async function publishComponents(
  tx: Db,
  ctx: Ctx,
  schemeId: string,
  components: Component[],
  expectedVersion: number,
  opts: PublishOptions = { clearDraft: false },
): Promise<PublishComponentsResult> {
  assertRole(ctx, ["admin"]);
  const now = new Date();
  const [row] = await tx
    .update(s.schemes)
    .set({
      components,
      published: true,
      version: sql`${s.schemes.version} + 1`,
      publishedAt: now,
      publishedBy: ctx.userId,
      updatedAt: now,
      ...(opts.clearDraft ? { draft: null, draftRev: sql`${s.schemes.draftRev} + 1` } : {}),
    })
    .where(
      and(
        eq(s.schemes.id, String(schemeId)),
        eq(s.schemes.companyId, ctx.companyId),
        eq(s.schemes.version, expectedVersion),
        ...(opts.clearDraft ? [eq(s.schemes.draftRev, opts.expectedDraftRev)] : []),
      ),
    )
    .returning({ version: s.schemes.version });
  if (!row) return STALE;
  await tx.insert(s.schemeVersions).values({
    id: randomUUID(),
    companyId: ctx.companyId,
    schemeId: String(schemeId),
    version: row.version,
    components,
    publishedBy: ctx.userId,
    publishedAt: now,
  });
  return { ok: true, version: row.version };
}

/**
 * What one rep of the caller's company would see on his commission screen if `components` were the
 * month's published scheme: the same loaders and engine calls as `getCommissionView` (same `asOf`,
 * projection and nearest win), read through `repCtx`. Nothing is written.
 */
export async function previewScheme(
  ctx: Ctx,
  input: Period & { components: unknown; repId: string; today: ISODate },
): Promise<PreviewResult> {
  assertRole(ctx, ["admin"]);
  const period = periodOf(input);
  if (!period) return badPeriod;
  if (typeof input.today !== "string" || !isISODate(input.today)) return { ok: false, issues: [{ path: "today", code: "shape" }] };
  const forRep = await repCtx(ctx, String(input.repId));
  if (!forRep) return { ok: false, error: "not_found" };

  const checked = validateComponents(input.components, await loadSchemeRefs(ctx.db, ctx, period));
  if (!checked.ok) return { ok: false, issues: checked.issues };
  const view = await commissionViewWith(
    forRep,
    { ...period, today: input.today },
    { id: "preview", name: "preview", components: checked.components },
  );
  return { ok: true, actual: view.actual, projected: view.projected, atFullTarget: view.atFullTarget, nearest: view.nearest };
}
