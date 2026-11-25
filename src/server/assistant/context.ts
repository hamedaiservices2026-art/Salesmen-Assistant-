// What the assistant is given: the rep's own figures as final, formatted facts (no model computes
// anything), his own incentive notifications and the company's policy sections, within a budget.
// Everything comes from the caller's own loaders and rows (`getMonthView`, `getCommissionView`,
// `getCompanyPrefs`, his notifications, his company's policies): no login, name, company name,
// other rep, close note or return is ever read here.
import { and, desc, eq, gte } from "drizzle-orm";
import * as s from "@/db/schema";
import { normaliseArabic } from "@/domain/ai/normalise";
import { numbersIn } from "@/domain/assistant/numbers";
import type { ISODate } from "@/domain/calendar";
import { componentLabel, type Component, type LeafCondition } from "@/domain/commission";
import { checkLeaf } from "@/domain/commission/evaluate";
import { focusName } from "@/domain/focus";
import { lineName, type LineKind } from "@/domain/lines";
import { formatAmount, type Currency, type Unit } from "@/domain/money";
import { todayNeed } from "@/domain/pace";
import type { Locale } from "@/i18n/config";
import ar from "@/i18n/messages/ar.json";
import en from "@/i18n/messages/en.json";
import ur from "@/i18n/messages/ur.json";
import { assertOwnContext, assertRole } from "@/server/auth/roles";
import type { Ctx } from "@/server/ctx";
import { contextTokens } from "@/server/ai/fake";
import { getCommissionView, type CommissionView } from "@/server/repos/commission";
import { getCompanyPrefs } from "@/server/repos/company";
import { getMonthView, type MonthView } from "@/server/repos/month-view";
import { pickText } from "@/server/repos/notifications";
import { loadPolicySections } from "@/server/repos/policy-read";
import { unitLabel } from "@/ui/unit-label";
import { CONTEXT_MAX_DEFAULT } from "@/server/ai/config";
import { cleanText, LINE_COST } from "./prompt";

/** id F1, F2, …; value is formatted text with its unit. */
export type Fact = { id: string; label: string; value: string };
/** tags D1…, S1… */
export type ContextDoc = { tag: string; title: string; sections: { tag: string; label: string; text: string }[] };
export type FactGroup = "days" | "line" | "coverage" | "focus" | "commission" | "incentive";
/**
 * Which catalog key a fact came from, so code (never the model) can pick the facts of a topic, and
 * the figures it states: the numbers of its value only, never of its label (a product name such as
 * `كولا 330 مل` is not a figure) and none for a window of dates (R81).
 */
export type FactMeta = { group: FactGroup; key: string; lineKind?: LineKind; numbers: string[] };
export type RepContext = {
  today: ISODate;
  facts: Fact[];
  incentives: { tag: string; title: string; body: string }[];
  docs: ContextDoc[];
  /** The figures of every fact (`FactMeta.numbers`) and the numbers of every incentive title and body. */
  factNumbers: Set<string>;
  /** Numbers of the incentive titles and bodies alone. */
  incentiveNumbers: Set<string>;
  /** Names we put in fact labels (lines, focus items, components), and the labels themselves, longest first: an answer may repeat one whole, digits and all, without them counting as figures. */
  names: string[];
  sectionNumbers: Map<string, Set<string>>;
  knownSections: Set<string>;
  factMeta: Map<string, FactMeta>;
};

export type Translate = (key: string, values?: Record<string, string | number>) => string;

export const CONTEXT_MAX = CONTEXT_MAX_DEFAULT;
/** Incentive notifications from the last 62 days, at most 10. */
const INCENTIVE_DAYS = 62;
const INCENTIVES_MAX = 10;
/** The `D` tag has at most two digits (`AnswerSchema`), the `S` tag four. */
const DOCS_MAX = 99;
const SECTIONS_MAX = 9999;
/** A single section's text is cut (at a space) to this many characters, so one huge section cannot crowd out the rest. */
const SECTION_TEXT_MAX = 6_000;
const NOTIFICATION_ID_MAX = 200;

const CATALOGS: Record<Locale, unknown> = { ar, en, ur };

/** A translator over the message catalogs (`{name}` placeholders), for callers without next-intl's. */
export function catalogTranslator(locale: Locale): Translate {
  const root = CATALOGS[locale] ?? CATALOGS.ar;
  return (key, values) => {
    let v: unknown = root;
    for (const part of key.split(".")) v = typeof v === "object" && v !== null ? (v as Record<string, unknown>)[part] : undefined;
    if (typeof v !== "string") return key;
    return v.replace(/\{(\w+)\}/g, (m, name: string) => (values && Object.hasOwn(values, name) ? String(values[name]) : m));
  };
}

type Draft = { label: string; value: string; meta: Omit<FactMeta, "numbers"> };

/** Facts whose value is a window of dates, a name or a word: they state no figure (R81). */
const NO_FIGURE_KEYS: ReadonlySet<string> = new Set(["focusWindow", "incentiveWindow", "nearestLine", "incentiveName", "lineStatus"]);

function monthOf(date: ISODate): { year: number; month: number } {
  return { year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)) };
}

function lastDayOf(year: number, month: number): ISODate {
  const d = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Formatting helpers bound to the caller's language and currency. */
function fmt(t: Translate, currency: Currency) {
  return {
    amount: (n: number, unit: Unit) => `${formatAmount(n, unit)} ${unitLabel((k) => t(k), unit, currency)}`,
    pct: (n: number) => `${n}%`,
    window: (start: string, end: string) => t("assistant.fact.window", { start, end }),
  };
}

function lineFacts(mv: MonthView, locale: Locale, t: Translate, f: ReturnType<typeof fmt>, names: Set<string>): Draft[] {
  const out: Draft[] = [];
  const F = (key: string) => `assistant.fact.${key}`;
  for (const l of mv.lines) {
    const line = lineName(l, locale);
    names.add(line);
    const meta = (key: string): Draft["meta"] => ({ group: l.kind === "coverage" ? "coverage" : "line", key, lineKind: l.kind });
    if (l.kind === "coverage") {
      const value = `${t(F("coverageValue"), { covered: formatAmount(l.achieved, "outlets"), total: formatAmount(l.target, "outlets") })} ${unitLabel((k) => t(k), "outlets", "SAR")}`;
      out.push({ label: t(F("coverage"), { line }), value, meta: meta("coverage") });
      continue;
    }
    const { pace } = l;
    out.push({ label: t(F("lineTarget"), { line }), value: f.amount(l.target, l.unit), meta: meta("lineTarget") });
    out.push({ label: t(F("lineAchieved"), { line }), value: f.amount(l.achieved, l.unit), meta: meta("lineAchieved") });
    if (pace.pct !== null) out.push({ label: t(F("linePct"), { line }), value: f.pct(pace.pct), meta: meta("linePct") });
    if (pace.status !== "no_target") {
      out.push({ label: t(F("lineExpected"), { line }), value: f.amount(pace.expected, l.unit), meta: meta("lineExpected") });
      out.push({ label: t(F("lineRemaining"), { line }), value: f.amount(pace.remaining, l.unit), meta: meta("lineRemaining") });
      const need = todayNeed({
        isSellingDay: mv.todaySelling,
        hasClosedToday: mv.hasClosedToday,
        requiredDaily: pace.requiredDaily,
        nextDayRequired: l.nextDayRequired,
        noTarget: false,
      });
      if (need.amount !== null) out.push({ label: t(F("lineDaily"), { line }), value: f.amount(need.amount, l.unit), meta: meta("lineDaily") });
    }
    out.push({ label: t(F("lineStatus"), { line }), value: t(F(`status.${pace.status}`)), meta: meta("lineStatus") });
  }
  return out;
}

function focusFacts(mv: MonthView, locale: Locale, t: Translate, f: ReturnType<typeof fmt>, names: Set<string>): Draft[] {
  const meta = (key: string): Draft["meta"] => ({ group: "focus", key });
  return mv.focus.flatMap((item) => {
    const name = focusName(item, locale);
    names.add(name);
    return [
      { label: t("assistant.fact.focusTarget", { item: name }), value: f.amount(item.target, item.unit), meta: meta("focusTarget") },
      { label: t("assistant.fact.focusAchieved", { item: name }), value: f.amount(item.achieved, item.unit), meta: meta("focusAchieved") },
      { label: t("assistant.fact.focusWindow", { item: name }), value: f.window(item.startsOn, item.endsOn), meta: meta("focusWindow") },
    ];
  });
}

function commissionFacts(cv: CommissionView, mv: MonthView, locale: Locale, t: Translate, f: ReturnType<typeof fmt>, names: Set<string>): Draft[] {
  if (cv.scheme === null || cv.tooLarge) return [];
  const meta = (key: string): Draft["meta"] => ({ group: "commission", key });
  const out: Draft[] = [
    { label: t("assistant.fact.commissionSoFar"), value: f.amount(cv.actual.total, "value"), meta: meta("commissionSoFar") },
    { label: t("assistant.fact.commissionProjected"), value: f.amount(cv.projected.total, "value"), meta: meta("commissionProjected") },
    { label: t("assistant.fact.commissionFull"), value: f.amount(cv.atFullTarget.total, "value"), meta: meta("commissionFull") },
  ];
  const components = new Map(cv.scheme.components.map((c) => [c.id, c]));
  for (const r of cv.actual.results) {
    const c = components.get(r.componentId);
    const label = c ? componentLabel(c, locale) : r.label;
    names.add(label);
    out.push({ label: t("assistant.fact.componentSoFar", { label }), value: f.amount(r.amount, "value"), meta: meta("componentSoFar") });
  }
  const n = cv.nearest;
  if (n) {
    const line = n.lineId ? mv.lines.find((l) => l.lineId === n.lineId) : undefined;
    const item = n.focusItemId ? mv.focus.find((x) => x.id === n.focusItemId) : undefined;
    const name = line ? lineName(line, locale) : item ? focusName(item, locale) : n.label;
    const unit: Unit = line?.unit ?? item?.unit ?? "cases";
    names.add(name);
    out.push({ label: t("assistant.fact.nearestLine"), value: name, meta: meta("nearestLine") });
    if (line || item) out.push({ label: t("assistant.fact.nearestGap"), value: f.amount(n.gap, unit), meta: meta("nearestGap") });
    out.push({ label: t("assistant.fact.nearestGain"), value: f.amount(n.gain, "value"), meta: meta("nearestGain") });
  }
  return out;
}

/**
 * The facts of one incentive component (R36): its label, configured amount, window, each condition's
 * threshold and the rep's progress on it. The scheme is loaded by id in the caller's company only;
 * no scheme or no bonus component with that id → no facts (the incentive text alone).
 */
async function componentFacts(ctx: Ctx, ref: string | null, today: ISODate, t: Translate, currency: Currency, names: Set<string>): Promise<Draft[]> {
  if (typeof ref !== "string") return [];
  const cut = ref.lastIndexOf(":");
  if (cut <= 0 || cut === ref.length - 1) return [];
  const schemeId = ref.slice(0, cut);
  const componentId = ref.slice(cut + 1);
  const [scheme] = await ctx.db
    .select({ year: s.schemes.year, month: s.schemes.month, components: s.schemes.components })
    .from(s.schemes)
    .where(and(eq(s.schemes.id, schemeId), eq(s.schemes.companyId, ctx.companyId)));
  const c: Component | undefined = scheme?.components.find((x) => x.id === componentId);
  if (!scheme || !c || c.type !== "bonus") return [];

  const f = fmt(t, currency);
  names.add(componentLabel(c, ctx.locale));
  const meta = (key: string): Draft["meta"] => ({ group: "incentive", key });
  const out: Draft[] = [
    { label: t("assistant.fact.incentiveName"), value: componentLabel(c, ctx.locale), meta: meta("incentiveName") },
    { label: t("assistant.fact.incentiveAmount"), value: f.amount(c.amount, "value"), meta: meta("incentiveAmount") },
    { label: t("assistant.fact.incentiveWindow"), value: f.window(c.startsOn, c.endsOn), meta: meta("incentiveWindow") },
  ];
  // Progress is read in the scheme's month, as of today (clamped to that month).
  const start = `${scheme.year}-${String(scheme.month).padStart(2, "0")}-01`;
  const end = lastDayOf(scheme.year, scheme.month);
  const asOf = today < start ? start : today > end ? end : today;
  const period = { year: scheme.year, month: scheme.month, today: asOf };
  const [mv, cv] = await Promise.all([getMonthView(ctx, period), getCommissionView(ctx, period)]);
  const leaves: LeafCondition[] = c.condition.kind === "all" ? c.condition.conditions : [c.condition];
  for (const leaf of leaves) {
    const part = checkLeaf(leaf, cv.input);
    if (leaf.kind === "line_pct_at_least") {
      const line = mv.lines.find((l) => l.lineId === leaf.lineId);
      const target = line ? lineName(line, ctx.locale) : componentLabel(c, ctx.locale);
      names.add(target);
      out.push({ label: t("assistant.fact.incentiveThreshold", { target }), value: f.pct(leaf.minPct), meta: meta("incentiveThreshold") });
      if (part.pct !== undefined) out.push({ label: t("assistant.fact.incentiveProgress", { target }), value: f.pct(part.pct), meta: meta("incentiveProgress") });
    } else {
      const item = mv.focus.find((x) => x.id === leaf.focusItemId);
      const target = item ? focusName(item, ctx.locale) : componentLabel(c, ctx.locale);
      names.add(target);
      const unit: Unit = item?.unit ?? "cases";
      out.push({ label: t("assistant.fact.incentiveThreshold", { target }), value: f.amount(leaf.min, unit), meta: meta("incentiveThreshold") });
      out.push({ label: t("assistant.fact.incentiveProgress", { target }), value: f.amount(part.achieved, unit), meta: meta("incentiveProgress") });
    }
  }
  return out;
}

/** Cut at a space at or before `max` characters (a number is never split), or hard at `max`. */
function cutText(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = text.slice(0, max).toWellFormed();
  const space = head.search(/\s\S*$/u);
  return (space > max / 2 ? head.slice(0, space) : head).trim();
}

function unique(xs: string[]): string[] {
  return [...new Set(xs)];
}

function numbersOf(...texts: string[]): string[] {
  return texts.flatMap((x) => numbersIn(x));
}

/** Each token counts at most this many times in a section. */
const TOKEN_HITS_MAX = 3;

/**
 * How well a section matches the question's tokens (R81): each distinct token found weighs 4, each
 * occurrence 1 more (at most 3 per token), divided by a length factor, so a section stuffed
 * with one word (or very long) cannot crowd out a short one that answers. 0 when no token occurs.
 */
export function sectionScore(tokens: readonly string[], label: string, text: string): number {
  const hay = normaliseArabic(`${label} ${text}`);
  let hits = 0;
  let distinct = 0;
  for (const tok of new Set(tokens)) {
    if (tok === "") continue;
    let n = 0;
    for (let at = hay.indexOf(tok); at >= 0 && n < TOKEN_HITS_MAX; at = hay.indexOf(tok, at + tok.length)) n++;
    hits += n;
    if (n > 0) distinct++;
  }
  // A different token weighs more than a repeat of the same one.
  return hits === 0 ? 0 : (distinct * (TOKEN_HITS_MAX + 1) + hits) / (1 + hay.length / 1000);
}

type Candidate = { doc: number; section: number; label: string; text: string; cost: number; score: number };

/**
 * The rep's context. Facts for the month of `today` (selling days; per line target, achieved,
 * percent, expected by today, remaining, needed per selling day, status; coverage covered of total;
 * focus items; commission so far, expected, at full target, each component so far and the nearest
 * win, left out when the commission view is `tooLarge`); his incentive notifications of the last 62
 * days (at most 10); the company's policy sections, best-first by the question's tokens when
 * everything does not fit in `CONTEXT_MAX`. With `only`, just that notification (which must be the
 * caller's own, else null) and its component's facts, no documents. Only a rep or supervisor acting
 * as himself.
 */
export async function buildRepContext(
  ctx: Ctx,
  opts: { today: ISODate; question: string; t: Translate; only?: { notificationId: string }; now?: Date; budget?: number },
): Promise<RepContext | null> {
  assertRole(ctx, ["rep", "supervisor"]);
  assertOwnContext(ctx);
  const { today, t } = opts;
  const now = opts.now ?? new Date();
  const prefs = await getCompanyPrefs(ctx);
  const f = fmt(t, prefs.currency);
  const budget = Math.min(CONTEXT_MAX, Number.isSafeInteger(opts.budget) && opts.budget! > 0 ? opts.budget! : CONTEXT_MAX);
  const since = new Date(now.getTime() - INCENTIVE_DAYS * 86_400_000);
  const rawNames = new Set<string>();

  let drafts: Draft[] = [];
  let notes: { title: s.LocalText; body: s.LocalText }[];
  let policy: Awaited<ReturnType<typeof loadPolicySections>> = [];

  if (opts.only !== undefined) {
    const id = opts.only.notificationId;
    if (typeof id !== "string" || id === "" || id.length > NOTIFICATION_ID_MAX) return null;
    const [note] = await ctx.db
      .select({ title: s.notifications.title, body: s.notifications.body, ref: s.notifications.ref })
      .from(s.notifications)
      .where(
        and(
          eq(s.notifications.id, id),
          eq(s.notifications.userId, ctx.userId),
          eq(s.notifications.companyId, ctx.companyId),
          eq(s.notifications.kind, "incentive"),
          // R81: an explain request names a notification of the last 62 days, like the list it came from.
          gte(s.notifications.createdAt, since),
        ),
      );
    if (!note) return null;
    notes = [note];
    drafts = await componentFacts(ctx, note.ref, today, t, prefs.currency, rawNames);
  } else {
    const period = { ...monthOf(today), today };
    const [mv, cv, rows, docs] = await Promise.all([
      getMonthView(ctx, period),
      getCommissionView(ctx, period),
      ctx.db
        .select({ title: s.notifications.title, body: s.notifications.body })
        .from(s.notifications)
        .where(
          and(
            eq(s.notifications.userId, ctx.userId),
            eq(s.notifications.companyId, ctx.companyId),
            eq(s.notifications.kind, "incentive"),
            gte(s.notifications.createdAt, since),
          ),
        )
        .orderBy(desc(s.notifications.createdAt), desc(s.notifications.id))
        .limit(INCENTIVES_MAX),
      loadPolicySections(ctx),
    ]);
    const daysMeta = (key: string): Draft["meta"] => ({ group: "days", key });
    drafts = [
      { label: t("assistant.fact.daysTotal"), value: String(mv.counts.total), meta: daysMeta("daysTotal") },
      { label: t("assistant.fact.daysPassed"), value: String(mv.counts.elapsed), meta: daysMeta("daysPassed") },
      { label: t("assistant.fact.daysLeft"), value: String(mv.counts.left), meta: daysMeta("daysLeft") },
      ...lineFacts(mv, ctx.locale, t, f, rawNames),
      ...focusFacts(mv, ctx.locale, t, f, rawNames),
      ...commissionFacts(cv, mv, ctx.locale, t, f, rawNames),
    ];
    notes = rows;
    policy = docs;
  }

  // Budget: the envelope, then facts and incentives (small and bounded), then sections.
  let used = LINE_COST.envelope;
  const facts: Fact[] = [];
  const factMeta = new Map<string, FactMeta>();
  for (const d of drafts) {
    const label = cleanText(d.label, true);
    const value = cleanText(d.value, true);
    const cost = LINE_COST.fact(label, value);
    if (label === "" || value === "" || used + cost > budget) continue;
    used += cost;
    const id = `F${facts.length + 1}`;
    facts.push({ id, label, value });
    factMeta.set(id, { ...d.meta, numbers: NO_FIGURE_KEYS.has(d.meta.key) ? [] : unique(numbersIn(value)) });
  }
  const incentives: RepContext["incentives"] = [];
  for (const n of notes) {
    const title = cleanText(pickText(n.title, ctx.locale), true);
    const body = cleanText(pickText(n.body, ctx.locale), false);
    const cost = LINE_COST.incentive(title, body);
    if (used + cost > budget) continue;
    used += cost;
    incentives.push({ tag: `I${incentives.length + 1}`, title, body });
  }

  const docs = selectSections(policy.slice(0, DOCS_MAX), opts.question, budget - used);

  const incentiveNumbers = new Set(incentives.flatMap((x) => numbersOf(x.title, x.body)));
  const factNumbers = new Set([...[...factMeta.values()].flatMap((m) => m.numbers), ...incentiveNumbers]);
  const names = [...new Set([...[...rawNames].map((n) => cleanText(n, true)), ...facts.map((x) => x.label)])]
    .filter((n) => n !== "")
    .sort((a, b) => b.length - a.length);
  const sectionNumbers = new Map<string, Set<string>>();
  for (const d of docs) for (const sec of d.sections) sectionNumbers.set(`${d.tag}/${sec.tag}`, new Set(numbersOf(sec.label, sec.text)));
  return {
    today,
    facts,
    incentives,
    docs,
    factNumbers,
    incentiveNumbers,
    names,
    sectionNumbers,
    knownSections: new Set(sectionNumbers.keys()),
    factMeta,
  };
}

/**
 * The sections that fit in `budget` characters: all of them when they fit; otherwise ranked by how
 * many of the question's tokens (normalised, leading `ال` removed, 3+ characters) each contains,
 * best first, ties in document order, each added while it fits. Output keeps document order; a
 * document with no section kept is left out. Tags: `D<position of the document>`, `S<position of
 * the section in it>`, so a citation maps back to our own title and label.
 */
function selectSections(policy: Awaited<ReturnType<typeof loadPolicySections>>, question: string, budget: number): ContextDoc[] {
  const titles = policy.map((d) => cleanText(d.title, true));
  const candidates: Candidate[] = [];
  policy.forEach((d, di) => {
    d.sections.slice(0, SECTIONS_MAX).forEach((sec, si) => {
      const label = cleanText(String(sec?.label ?? ""), true);
      const text = cutText(cleanText(String(sec?.text ?? ""), false), SECTION_TEXT_MAX);
      if (label === "" && text === "") return;
      candidates.push({ doc: di, section: si, label, text, cost: LINE_COST.section(label, text), score: 0 });
    });
  });

  const docCost = (di: number) => LINE_COST.doc(titles[di] ?? "");
  const everything = candidates.reduce((n, c) => n + c.cost, 0) + [...new Set(candidates.map((c) => c.doc))].reduce((n, di) => n + docCost(di), 0);
  let chosen: Candidate[];
  if (everything <= budget) {
    chosen = candidates;
  } else {
    const tokens = [...new Set(contextTokens(question))];
    for (const c of candidates) c.score = sectionScore(tokens, c.label, c.text);
    const ranked = candidates.map((c, i) => ({ c, i })).sort((a, b) => b.c.score - a.c.score || a.i - b.i);
    const docsIn = new Set<number>();
    let used = 0;
    chosen = [];
    for (const { c } of ranked) {
      const cost = c.cost + (docsIn.has(c.doc) ? 0 : docCost(c.doc));
      if (used + cost > budget) continue;
      used += cost;
      docsIn.add(c.doc);
      chosen.push(c);
    }
    chosen.sort((a, b) => a.doc - b.doc || a.section - b.section);
  }

  const out: ContextDoc[] = [];
  for (const c of chosen) {
    const tag = `D${c.doc + 1}`;
    let doc = out.at(-1);
    if (!doc || doc.tag !== tag) {
      doc = { tag, title: titles[c.doc] ?? "", sections: [] };
      out.push(doc);
    }
    doc.sections.push({ tag: `S${c.section + 1}`, label: c.label, text: c.text });
  }
  return out;
}
