import { and, asc, eq, sql } from "drizzle-orm";
import * as s from "@/db/schema";
import { ALIASES_PER_FIELD, cleanAlias, isBlankAlias, vocabulary, type VocabularyEntry, type VocabularyLine } from "@/domain/ai/aliases";
import { draftKeys, lineKey, type DraftKey } from "@/domain/ai/draft";
import { lineName } from "@/domain/lines";
import type { Locale } from "@/i18n/config";
import { assertRole } from "@/server/auth/roles";
import type { Ctx } from "@/server/ctx";

export type FieldMapKey = { key: DraftKey; label: string; defaults: string[] };
export type FieldMapView = { version: number; aliases: Record<string, string[]>; keys: FieldMapKey[] };
export type FieldMapError = "invalid" | "too_many" | "unknown_key";
export type SaveFieldMapResult =
  | { ok: true; version: number }
  | { ok: false; errors: Record<string, FieldMapError> }
  | { ok: false; error: "stale" };

/** The company's daily lines in use (coverage lines are never part of a draft), in screen order. */
async function loadLines(ctx: Ctx): Promise<(VocabularyLine & { nameAr: string })[]> {
  const rows = await ctx.db
    .select()
    .from(s.targetLines)
    .where(and(eq(s.targetLines.companyId, ctx.companyId), eq(s.targetLines.active, true)))
    .orderBy(asc(s.targetLines.sort), asc(s.targetLines.code));
  return rows
    .filter((r) => r.kind !== "coverage")
    .map((r) => ({ lineId: r.id, code: r.code, unit: r.unit, kind: r.kind, nameAr: r.nameAr, nameEn: r.nameEn, nameUr: r.nameUr }));
}

async function loadStored(ctx: Ctx): Promise<{ version: number; aliases: Record<string, string[]> }> {
  const [row] = await ctx.db
    .select({ version: s.aiFieldMaps.version, aliases: s.aiFieldMaps.aliases })
    .from(s.aiFieldMaps)
    .where(eq(s.aiFieldMaps.companyId, ctx.companyId));
  return row ? { version: row.version, aliases: row.aliases ?? {} } : { version: 0, aliases: {} };
}

/** What the mapping page shows: the saved labels, the version to send back, and each field with its built-in labels. Admin only. */
export async function getFieldMap(ctx: Ctx, locale: Locale = ctx.locale): Promise<FieldMapView> {
  assertRole(ctx, ["admin"]);
  const [lines, stored] = await Promise.all([loadLines(ctx), loadStored(ctx)]);
  const vocab = vocabulary(lines, {});
  const byKey = new Map(lines.map((l) => [lineKey(l.code), l]));
  const keys = vocab.map((e) => {
    const line = byKey.get(e.key);
    return { key: e.key, label: line ? lineName(line, locale) : e.key, defaults: e.labels };
  });
  const aliases: Record<string, string[]> = {};
  for (const { key } of keys) {
    const own = Object.hasOwn(stored.aliases, key) ? stored.aliases[key] : undefined;
    if (Array.isArray(own) && own.length > 0) aliases[key] = own.filter((a): a is string => typeof a === "string");
  }
  return { version: stored.version, aliases, keys };
}

/**
 * Saves the company's labels. Admin only; the company comes from the session. Keys must be the
 * company's own draft keys; each label is cleaned (`cleanAlias`), blank rows are dropped, duplicates
 * are folded ignoring case, at most 8 per field. Problems come back per field. The first save inserts
 * with ON CONFLICT DO NOTHING, so of two racing first saves one is `stale` (R53); later saves update
 * only when the stored version is the one the editor read.
 */
export async function saveFieldMap(ctx: Ctx, input: { version: number; aliases: Record<string, string[]> }): Promise<SaveFieldMapResult> {
  assertRole(ctx, ["admin"]);
  const lines = await loadLines(ctx);
  const allowed = new Set<string>(draftKeys(lines).map((k) => k.key));
  const errors: Record<string, FieldMapError> = {};
  const clean: Record<string, string[]> = {};
  const raw = input.aliases !== null && typeof input.aliases === "object" ? input.aliases : {};
  for (const [key, list] of Object.entries(raw)) {
    if (!allowed.has(key)) {
      errors[key] = "unknown_key";
      continue;
    }
    if (!Array.isArray(list)) {
      errors[key] = "invalid";
      continue;
    }
    const out: string[] = [];
    const seen = new Set<string>();
    let bad = false;
    for (const a of list) {
      if (typeof a !== "string") {
        bad = true;
        break;
      }
      if (isBlankAlias(a)) continue;
      const c = cleanAlias(a);
      if (c === null) {
        bad = true;
        break;
      }
      if (seen.has(c.toLowerCase())) continue;
      seen.add(c.toLowerCase());
      out.push(c);
    }
    if (bad) errors[key] = "invalid";
    else if (out.length > ALIASES_PER_FIELD) errors[key] = "too_many";
    else if (out.length > 0) clean[key] = out;
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  if (!Number.isInteger(input.version) || input.version < 0) return { ok: false, error: "stale" };
  // Labels stored for keys the company does not have right now (a line turned off) are carried through
  // unchanged, so turning the line back on restores them (R73).
  const stored = await loadStored(ctx);
  const kept: Record<string, string[]> = {};
  for (const [key, list] of Object.entries(stored.aliases)) {
    if (allowed.has(key) || !Array.isArray(list)) continue;
    kept[key] = list.filter((a): a is string => typeof a === "string");
  }
  const merged = { ...clean, ...kept };

  if (input.version === 0) {
    const inserted = await ctx.db
      .insert(s.aiFieldMaps)
      .values({ companyId: ctx.companyId, aliases: merged, version: 1, updatedBy: ctx.userId })
      .onConflictDoNothing()
      .returning({ version: s.aiFieldMaps.version });
    return inserted[0] ? { ok: true, version: inserted[0].version } : { ok: false, error: "stale" };
  }
  const [updated] = await ctx.db
    .update(s.aiFieldMaps)
    .set({ aliases: merged, version: sql`${s.aiFieldMaps.version} + 1`, updatedBy: ctx.userId, updatedAt: new Date() })
    .where(and(eq(s.aiFieldMaps.companyId, ctx.companyId), eq(s.aiFieldMaps.version, input.version)))
    .returning({ version: s.aiFieldMaps.version });
  return updated ? { ok: true, version: updated.version } : { ok: false, error: "stale" };
}

/** The labels the report reader looks for, for the caller's own company (read only; any role that uses the app). */
export async function loadVocabulary(ctx: Ctx): Promise<VocabularyEntry[]> {
  assertRole(ctx, ["rep", "supervisor", "admin"]);
  const [lines, stored] = await Promise.all([loadLines(ctx), loadStored(ctx)]);
  return vocabulary(lines, stored.aliases);
}
