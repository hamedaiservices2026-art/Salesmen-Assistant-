import { randomInt, randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import * as s from "@/db/schema";
import type { ISODate } from "@/domain/calendar";
import { isISODate, validateComponents, type Component, type Condition, type SchemeIssue } from "@/domain/commission";
import { assertRole } from "@/server/auth/roles";
import type { Ctx } from "@/server/ctx";
import { pickText } from "@/server/repos/notifications";
import { loadSchemeRefs, publishComponents } from "./schemes";
import { AMOUNT_MAX } from "./targets";

export type LocalInput = { ar: string; en?: string; ur?: string };
export type IncentiveInput = {
  year: number;
  month: number;
  label: LocalInput;
  explanation: LocalInput;
  /** In value units (halalas). */
  amount: number;
  condition: Condition;
  startsOn: ISODate;
  endsOn: ISODate;
  /** The published version the admin's page was loaded with. */
  expectedVersion: number;
};
export type CreateIncentiveResult =
  | { ok: true; componentId: string; notified: number }
  | { ok: false; error: "no_published_scheme" | "stale" }
  | { ok: false; errors: Record<string, string> }
  | { ok: false; issues: SchemeIssue[] };

export type IncentiveRow = {
  componentId: string;
  label: string;
  amount: number;
  startsOn: ISODate;
  endsOn: ISODate;
  notified: number;
  seen: number;
};

export const LABEL_MAX = 80;
export const EXPLANATION_MAX = 500;
const ROLES = ["rep", "supervisor"] as const;
const ID_PREFIX = "inc_";

function periodOf(year: unknown, month: unknown): { year: number; month: number } | null {
  if (typeof year !== "number" || !Number.isInteger(year) || year < 2000 || year > 2100) return null;
  if (typeof month !== "number" || !Number.isInteger(month) || month < 1 || month > 12) return null;
  return { year, month };
}

/** Trims the three texts; `ar` is required, the others are dropped when blank. Field problems go into `errors` under `prefix`. */
function cleanText(raw: unknown, prefix: string, max: number, errors: Record<string, string>): s.LocalText {
  const src = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const out: s.LocalText = { ar: "" };
  for (const [lang, field] of [["ar", prefix], ["en", `${prefix}En`], ["ur", `${prefix}Ur`]] as const) {
    const v = src[lang];
    const text = typeof v === "string" ? v.trim() : "";
    if (v !== undefined && typeof v !== "string") errors[field] = "invalid";
    else if ([...text].length > max) errors[field] = "too_long";
    else if (lang === "ar") {
      if (text === "") errors[field] = "required";
      out.ar = text;
    } else if (text !== "") out[lang] = text;
  }
  return out;
}

/** `inc_` and six base36 characters, not among the scheme's existing component ids. */
function newComponentId(taken: Set<string>): string {
  for (let i = 0; i < 50; i++) {
    let suffix = "";
    for (let k = 0; k < 6; k++) suffix += randomInt(36).toString(36);
    const id = ID_PREFIX + suffix;
    if (!taken.has(id)) return id;
  }
  throw new Error("could not make a free incentive id");
}

function focusIdsOf(c: Condition): string[] {
  const leaves = c.kind === "all" ? c.conditions : [c];
  return leaves.flatMap((l) => (l.kind === "focus_at_least" ? [l.focusItemId] : []));
}

/**
 * Who hears about a new incentive: when its condition names focus items, the active reps and
 * supervisors those items are assigned to; otherwise every active rep and supervisor who holds a
 * target in the month. Always the caller's company only.
 */
async function recipientsOf(tx: Db, ctx: Ctx, condition: Condition, period: { year: number; month: number }): Promise<string[]> {
  const focusIds = focusIdsOf(condition);
  const base = [eq(s.users.companyId, ctx.companyId), eq(s.users.active, true), inArray(s.users.role, [...ROLES])];
  if (focusIds.length > 0) {
    const rows = await tx
      .selectDistinct({ id: s.users.id })
      .from(s.focusAssignments)
      .innerJoin(s.users, eq(s.users.id, s.focusAssignments.userId))
      .where(and(eq(s.focusAssignments.companyId, ctx.companyId), inArray(s.focusAssignments.focusItemId, focusIds), ...base))
      .orderBy(asc(s.users.id));
    return rows.map((r) => r.id);
  }
  const rows = await tx
    .selectDistinct({ id: s.users.id })
    .from(s.targets)
    .innerJoin(s.users, eq(s.users.id, s.targets.userId))
    .where(and(eq(s.targets.companyId, ctx.companyId), eq(s.targets.year, period.year), eq(s.targets.month, period.month), ...base))
    .orderBy(asc(s.users.id));
  return rows.map((r) => r.id);
}

/** The texts, amount and window of an incentive, checked: field name to error code (`required`, `too_long`, `invalid`, `window_order`), and the cleaned texts. */
export function checkIncentiveFields(
  input: Pick<IncentiveInput, "label" | "explanation" | "amount" | "startsOn" | "endsOn">,
): { errors: Record<string, string>; label: s.LocalText; explanation: s.LocalText } {
  const errors: Record<string, string> = {};
  const label = cleanText(input.label, "label", LABEL_MAX, errors);
  const explanation = cleanText(input.explanation, "explanation", EXPLANATION_MAX, errors);
  if (!Number.isSafeInteger(input.amount) || input.amount < 1 || input.amount > AMOUNT_MAX) errors.amount = "invalid";
  for (const f of ["startsOn", "endsOn"] as const) {
    if (typeof input[f] !== "string" || !isISODate(input[f])) errors[f] = "invalid";
  }
  if (!errors.startsOn && !errors.endsOn && input.startsOn > input.endsOn) errors.endsOn = "window_order";
  return { errors, label, explanation };
}

/**
 * Adds a bonus to the month's published scheme and tells the reps it can reach, in one transaction.
 *
 * The write is `publishComponents`, the same single publish path the scheme editor uses: a new
 * version, `published_by`, a `scheme_versions` row. Lock order, as in `publishScheme`: the lines
 * the components name, then the focus items they name (both by id, in `loadSchemeRefs`), then the
 * scheme row (taken by the conditional `UPDATE ... WHERE version = expectedVersion`). The
 * notifications are inserted after that, so a publish that lost the race (`stale`) writes nothing.
 * Of two calls with the same `expectedVersion` exactly one wins.
 */
export async function createIncentive(ctx: Ctx, input: IncentiveInput): Promise<CreateIncentiveResult> {
  assertRole(ctx, ["admin"]);
  const period = periodOf(input.year, input.month);
  if (!period) return { ok: false, issues: [{ path: "period", code: "shape" }] };
  const { errors, label, explanation } = checkIncentiveFields(input);
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const expected = input.expectedVersion;
  if (!Number.isSafeInteger(expected) || expected < 0) return { ok: false, error: "stale" };

  return ctx.db.transaction(async (t) => {
    const tx = t as unknown as Db;
    const [row] = await tx
      .select()
      .from(s.schemes)
      .where(and(eq(s.schemes.companyId, ctx.companyId), eq(s.schemes.year, period.year), eq(s.schemes.month, period.month)));
    if (!row || !row.published) return { ok: false as const, error: "no_published_scheme" as const };
    if (row.version !== expected) return { ok: false as const, error: "stale" as const };

    const componentId = newComponentId(new Set(row.components.map((c) => c.id)));
    const bonus: Component = {
      id: componentId,
      type: "bonus",
      label: label.ar,
      ...(label.en ? { labelEn: label.en } : {}),
      ...(label.ur ? { labelUr: label.ur } : {}),
      condition: input.condition,
      amount: input.amount,
      startsOn: input.startsOn,
      endsOn: input.endsOn,
    };
    const components = [...row.components, bonus];
    const refs = await loadSchemeRefs(tx, ctx, period, { lock: components });
    const checked = validateComponents(components, refs);
    if (!checked.ok) return { ok: false as const, issues: checked.issues };

    const published = await publishComponents(tx, ctx, row.id, checked.components, expected);
    if (!published.ok) return { ok: false as const, error: "stale" as const };

    const recipients = await recipientsOf(tx, ctx, input.condition, period);
    if (recipients.length > 0) {
      await tx.insert(s.notifications).values(
        recipients.map((userId) => ({
          id: randomUUID(),
          companyId: ctx.companyId,
          userId,
          kind: "incentive" as const,
          title: label,
          body: explanation,
          ref: componentId,
        })),
      );
    }
    return { ok: true as const, componentId, notified: recipients.length };
  });
}

/** The month's mid-month incentives (bonuses made here) with how many reps were told and how many have opened it. */
export async function listIncentives(ctx: Ctx, input: { year: number; month: number }): Promise<IncentiveRow[]> {
  assertRole(ctx, ["admin"]);
  const period = periodOf(input.year, input.month);
  if (!period) return [];
  const [row] = await ctx.db
    .select({ components: s.schemes.components })
    .from(s.schemes)
    .where(
      and(
        eq(s.schemes.companyId, ctx.companyId),
        eq(s.schemes.year, period.year),
        eq(s.schemes.month, period.month),
        eq(s.schemes.published, true),
      ),
    );
  const made = (row?.components ?? []).filter((c) => c.type === "bonus" && c.id.startsWith(ID_PREFIX));
  if (made.length === 0) return [];
  const counts = await ctx.db
    .select({
      ref: s.notifications.ref,
      notified: sql<number>`count(*)::int`,
      seen: sql<number>`count(${s.notifications.readAt})::int`,
    })
    .from(s.notifications)
    .where(
      and(
        eq(s.notifications.companyId, ctx.companyId),
        eq(s.notifications.kind, "incentive"),
        isNotNull(s.notifications.ref),
        inArray(s.notifications.ref, made.map((c) => c.id)),
      ),
    )
    .groupBy(s.notifications.ref);
  const byRef = new Map(counts.map((c) => [c.ref, c]));
  return made.flatMap((c) =>
    c.type !== "bonus"
      ? []
      : [
          {
            componentId: c.id,
            label: pickText({ ar: c.label, en: c.labelEn, ur: c.labelUr }, ctx.locale),
            amount: c.amount,
            startsOn: c.startsOn as ISODate,
            endsOn: c.endsOn as ISODate,
            notified: byRef.get(c.id)?.notified ?? 0,
            seen: byRef.get(c.id)?.seen ?? 0,
          },
        ],
  );
}
