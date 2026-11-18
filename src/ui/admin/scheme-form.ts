import type { ISODate } from "@/domain/calendar";
import type { Component, Condition, LeafCondition, SchemeIssue, SchemeRefs } from "@/domain/commission";
import { inputValue, parseAmount, type Unit } from "@/domain/money";

/**
 * The commission editor's form logic: the cards as text exactly as typed, and the conversion to and
 * from the engine's `Component`s. No React here. The server (`validateComponents`) stays the
 * authority; this file only builds what the server will check and tells the admin which typed
 * field is empty or unreadable before anything is sent.
 *
 * Typing rules: money in the company currency (`parseAmount(s, "value")`, Arabic-Indic digits
 * accepted); a percent of sales with up to two decimals (`0.5` is 50 bps, which is the same
 * hundredths arithmetic as money); tier thresholds and condition percents whole numbers.
 */

export type Preset = "tiers" | "rate" | "bonus" | "coverage" | "volume" | "extra100" | "combined" | "gate";
export const PRESETS: readonly Preset[] = ["tiers", "rate", "bonus", "coverage", "volume", "extra100", "combined", "gate"];

/** Lines and focus items the form may offer; focus units are optional (cases when unknown). */
export type FormRefs = {
  lines: SchemeRefs["lines"];
  focus: { id: string; startsOn: ISODate; endsOn: ISODate; unit?: Unit }[];
  period: SchemeRefs["period"];
};

export type TierRow = { minPct: string; payKind: "fixed" | "pct"; pay: string };
/** One condition row. `kind` picks which pair of fields counts. */
export type LeafRow = {
  kind: "line" | "focus";
  lineId: string;
  minPct: string;
  focusItemId: string;
  min: string;
  /** The focus item's unit, which decides how `min` is parsed (money for a value item). */
  focusUnit: Unit;
};

export type EditorCard = {
  id: string;
  preset: Preset;
  type: Component["type"];
  label: { ar: string; en: string; ur: string };
  /** tiered and per_unit */
  lineId: string;
  /** tiered */
  tiers: TierRow[];
  /** per_unit: the kind follows the line (value: percent of value; cases or outlets: per case) */
  rateKind: "per_case" | "pct_of_value";
  rateValue: string;
  abovePct: string;
  /** bonus and gate: one row is a plain condition, two or more are joined by "and" (`all`) */
  leaves: LeafRow[];
  /** bonus */
  amount: string;
  startsOn: string;
  endsOn: string;
  /** gate: ids of the cards it holds back */
  appliesTo: string[];
};

export type FieldErrors = Record<string, "required" | "invalid">;

export const MAX_LEAVES = 4;

export function newId(): string {
  const bytes = new Uint32Array(1);
  globalThis.crypto.getRandomValues(bytes);
  return `c_${(bytes[0]! % 36 ** 6).toString(36).padStart(6, "0")}`;
}

export function lineOf(refs: Pick<FormRefs, "lines">, id: string) {
  return refs.lines.find((l) => l.id === id);
}
export function focusOf(refs: Pick<FormRefs, "focus">, id: string) {
  return refs.focus.find((f) => f.id === id);
}
/** Percentage pay is only for a line counted in money. */
export function allowsPct(refs: Pick<FormRefs, "lines">, lineId: string): boolean {
  return lineOf(refs, lineId)?.unit === "value";
}

const emptyLine = (lineId = "", minPct = ""): LeafRow => ({ kind: "line", lineId, minPct, focusItemId: "", min: "", focusUnit: "cases" });
const emptyFocus = (refs: FormRefs, focusItemId = ""): LeafRow => ({
  kind: "focus",
  lineId: "",
  minPct: "",
  focusItemId,
  min: "",
  focusUnit: focusOf(refs, focusItemId)?.unit ?? "cases",
});

const blank = (id: string, preset: Preset, type: Component["type"], period: FormRefs["period"]): EditorCard => ({
  id,
  preset,
  type,
  label: { ar: "", en: "", ur: "" },
  lineId: "",
  tiers: [],
  rateKind: "pct_of_value",
  rateValue: "",
  abovePct: "",
  leaves: [],
  amount: "",
  startsOn: period.start,
  endsOn: period.end,
  appliesTo: [],
});

/** A new card for a preset: the choices the admin has not made yet stay empty. */
export function newCard(preset: Preset, refs: FormRefs, period: { start: ISODate; end: ISODate }): EditorCard {
  const firstDaily = refs.lines.find((l) => l.kind !== "coverage")?.id ?? "";
  switch (preset) {
    case "tiers":
      return { ...blank(newId(), preset, "tiered", period), lineId: firstDaily, tiers: [{ minPct: "", payKind: "fixed", pay: "" }] };
    case "coverage":
      return {
        ...blank(newId(), preset, "tiered", period),
        lineId: refs.lines.find((l) => l.kind === "coverage")?.id ?? "",
        tiers: [{ minPct: "85", payKind: "fixed", pay: "" }],
      };
    case "rate": {
      const c = { ...blank(newId(), preset, "per_unit", period), lineId: firstDaily };
      return { ...c, rateKind: rateKindFor(refs, firstDaily) };
    }
    case "bonus":
      return { ...blank(newId(), preset, "bonus", period), leaves: [emptyLine(firstDaily)] };
    case "extra100":
      return { ...blank(newId(), preset, "bonus", period), leaves: [emptyLine(firstDaily, "100")] };
    case "combined":
      return { ...blank(newId(), preset, "bonus", period), leaves: [emptyLine(), emptyLine()] };
    case "volume": {
      const item = refs.focus[0];
      const c = { ...blank(newId(), preset, "bonus", period), leaves: [emptyFocus(refs, item?.id ?? "")] };
      return withWindow(c, refs);
    }
    case "gate":
      return { ...blank(newId(), preset, "gate", period), leaves: [emptyLine()] };
  }
}

export function rateKindFor(refs: Pick<FormRefs, "lines">, lineId: string): "per_case" | "pct_of_value" {
  const unit = lineOf(refs, lineId)?.unit;
  return unit === "cases" || unit === "outlets" ? "per_case" : "pct_of_value";
}

// ---- Editing helpers (pure; each returns a new card) ----

/** A bonus's window is the whole month, or its focus item's window when a row names one (the server's rule). */
export function withWindow(card: EditorCard, refs: FormRefs): EditorCard {
  if (card.type !== "bonus") return card;
  const item = card.leaves.filter((l) => l.kind === "focus").map((l) => focusOf(refs, l.focusItemId)).find(Boolean);
  const startsOn = item?.startsOn ?? refs.period.start;
  const endsOn = item?.endsOn ?? refs.period.end;
  return card.startsOn === startsOn && card.endsOn === endsOn ? card : { ...card, startsOn, endsOn };
}

export function setLine(card: EditorCard, lineId: string, refs: FormRefs): EditorCard {
  if (card.type === "per_unit") {
    const rateKind = rateKindFor(refs, lineId);
    return { ...card, lineId, rateKind, rateValue: rateKind === card.rateKind ? card.rateValue : "" };
  }
  const tiers: TierRow[] = allowsPct(refs, lineId)
    ? card.tiers
    : card.tiers.map((t) => (t.payKind === "pct" ? { ...t, payKind: "fixed", pay: "" } : t));
  return { ...card, lineId, tiers };
}

export function setLeaf(card: EditorCard, index: number, patch: Partial<LeafRow>, refs: FormRefs): EditorCard {
  return withWindow({ ...card, leaves: card.leaves.map((l, i) => (i === index ? { ...l, ...patch } : l)) }, refs);
}

export function setLeafFocus(card: EditorCard, index: number, focusItemId: string, refs: FormRefs): EditorCard {
  return setLeaf(card, index, { focusItemId, focusUnit: focusOf(refs, focusItemId)?.unit ?? "cases", min: "" }, refs);
}

export function setLeafKind(card: EditorCard, index: number, kind: "line" | "focus", refs: FormRefs): EditorCard {
  const fresh = kind === "line" ? emptyLine() : emptyFocus(refs);
  return withWindow({ ...card, leaves: card.leaves.map((l, i) => (i === index ? fresh : l)) }, refs);
}

export function addLeaf(card: EditorCard, kind: "line" | "focus", refs: FormRefs): EditorCard {
  if (card.leaves.length >= MAX_LEAVES) return card;
  return withWindow({ ...card, leaves: [...card.leaves, kind === "line" ? emptyLine() : emptyFocus(refs)] }, refs);
}

export function removeLeaf(card: EditorCard, index: number, refs: FormRefs): EditorCard {
  return withWindow({ ...card, leaves: card.leaves.filter((_, i) => i !== index) }, refs);
}

/** Removing a card also drops it from every gate's list. */
export function removeCard(cards: EditorCard[], id: string): EditorCard[] {
  return cards.filter((c) => c.id !== id).map((c) => (c.appliesTo.includes(id) ? { ...c, appliesTo: c.appliesTo.filter((a) => a !== id) } : c));
}

export function moveCard(cards: EditorCard[], index: number, by: -1 | 1): EditorCard[] {
  const to = index + by;
  if (to < 0 || to >= cards.length) return cards;
  const next = [...cards];
  const [moved] = next.splice(index, 1);
  next.splice(to, 0, moved!);
  return next;
}

// ---- Components to cards ----

const text = (n: number, unit: Unit) => inputValue(n, unit);
/** Basis points as the typed percent: 50 gives "0.5", 125 gives "1.25", 100 gives "1". */
const pctText = (bps: number) => inputValue(bps, "value").replace(/(\.\d)0$/, "$1");

function leafRow(l: LeafCondition, refs: FormRefs): LeafRow {
  return l.kind === "line_pct_at_least"
    ? { kind: "line", lineId: l.lineId, minPct: String(l.minPct), focusItemId: "", min: "", focusUnit: "cases" }
    : {
        kind: "focus",
        lineId: "",
        minPct: "",
        focusItemId: l.focusItemId,
        min: text(l.min, focusOf(refs, l.focusItemId)?.unit ?? "cases"),
        focusUnit: focusOf(refs, l.focusItemId)?.unit ?? "cases",
      };
}
const leavesOf = (c: Condition): LeafCondition[] => (c.kind === "all" ? c.conditions : [c]);

/** Cards for stored components, with a preset guessed from their shape. Nothing is changed or fixed. */
export function fromComponents(components: Component[], refs: FormRefs): EditorCard[] {
  return components.map((c): EditorCard => {
    const base = {
      ...blank(c.id, "tiers", c.type, refs.period),
      label: { ar: c.label, en: c.labelEn ?? "", ur: c.labelUr ?? "" },
    };
    switch (c.type) {
      case "tiered":
        return {
          ...base,
          preset: lineOf(refs, c.lineId)?.kind === "coverage" ? "coverage" : "tiers",
          lineId: c.lineId,
          tiers: c.tiers.map((t) =>
            t.pay.kind === "fixed"
              ? { minPct: String(t.minPct), payKind: "fixed", pay: text(t.pay.amount, "value") }
              : { minPct: String(t.minPct), payKind: "pct", pay: pctText(t.pay.bps) },
          ),
        };
      case "per_unit":
        return {
          ...base,
          preset: "rate",
          lineId: c.lineId,
          rateKind: c.rate.kind,
          rateValue: c.rate.kind === "per_case" ? text(c.rate.amount, "value") : pctText(c.rate.bps),
          abovePct: c.abovePct === undefined ? "" : String(c.abovePct),
        };
      case "bonus": {
        const leaves = leavesOf(c.condition).map((l) => leafRow(l, refs));
        const only = c.condition.kind === "all" ? null : c.condition;
        const preset: Preset =
          c.condition.kind === "all" ? "combined" : only?.kind === "focus_at_least" ? "volume" : only?.minPct === 100 ? "extra100" : "bonus";
        return { ...base, preset, leaves, amount: text(c.amount, "value"), startsOn: c.startsOn, endsOn: c.endsOn };
      }
      case "gate":
        return { ...base, preset: "gate", leaves: leavesOf(c.condition).map((l) => leafRow(l, refs)), appliesTo: [...c.appliesTo] };
    }
  });
}

// ---- Cards to components ----

type Parsed<T> = { value: T } | { error: "required" | "invalid" };
const isError = <T>(p: Parsed<T>): p is { error: "required" | "invalid" } => "error" in p;

function parseNumber(s: string, unit: Unit): Parsed<number> {
  if (s.trim() === "") return { error: "required" };
  const n = parseAmount(s, unit);
  return n === null ? { error: "invalid" } : { value: n };
}

type Built = { component: Component | null };

/**
 * The engine components for the cards, plus an error for every field that is empty ("required") or
 * not a readable number ("invalid"), keyed `<cardId>.<field>`: `label`, `lineId`, `tiers.0.minPct`,
 * `tiers.0.pay`, `rate`, `abovePct`, `leaves.0.lineId|minPct|focusItemId|min`, `amount`,
 * `appliesTo`. Only when there are no field errors are the components complete and in the cards'
 * order (so a server issue `components.N` is card N); otherwise cards with errors are left out.
 */
export function toComponents(cards: EditorCard[]): { components: Component[]; fieldErrors: FieldErrors } {
  const fieldErrors: FieldErrors = {};
  const components: Component[] = [];
  for (const card of cards) {
    const errors: FieldErrors = {};
    const need = <T>(field: string, p: Parsed<T>): T | undefined => {
      if (isError(p)) {
        errors[`${card.id}.${field}`] = p.error;
        return undefined;
      }
      return p.value;
    };
    const ar = card.label.ar.trim();
    if (ar === "") errors[`${card.id}.label`] = "required";
    const labels = {
      label: ar,
      ...(card.label.en.trim() === "" ? {} : { labelEn: card.label.en.trim() }),
      ...(card.label.ur.trim() === "" ? {} : { labelUr: card.label.ur.trim() }),
    };
    const built = buildOne(card, labels, need, errors);
    if (Object.keys(errors).length > 0) Object.assign(fieldErrors, errors);
    else if (built.component) components.push(built.component);
  }
  return { components, fieldErrors };
}

function buildOne(
  card: EditorCard,
  labels: { label: string; labelEn?: string; labelUr?: string },
  need: <T>(field: string, p: Parsed<T>) => T | undefined,
  errors: FieldErrors,
): Built {
  const id = card.id;
  const req = (field: string, value: string) => {
    if (value.trim() === "") errors[`${id}.${field}`] = "required";
    return value.trim();
  };

  if (card.type === "tiered") {
    const lineId = req("lineId", card.lineId);
    const tiers = card.tiers.map((t, i) => {
      const minPct = need(`tiers.${i}.minPct`, parseNumber(t.minPct, "cases"));
      const pay = need(`tiers.${i}.pay`, parseNumber(t.pay, "value"));
      if (minPct === undefined || pay === undefined) return null;
      return { minPct, pay: t.payKind === "fixed" ? { kind: "fixed" as const, amount: pay } : { kind: "pct_of_achieved" as const, bps: pay } };
    });
    if (tiers.some((t) => t === null)) return { component: null };
    return { component: { id, type: "tiered", lineId, tiers: tiers as NonNullable<(typeof tiers)[number]>[], ...labels } };
  }

  if (card.type === "per_unit") {
    const lineId = req("lineId", card.lineId);
    const value = need("rate", parseNumber(card.rateValue, "value"));
    const above = card.abovePct.trim() === "" ? null : need("abovePct", parseNumber(card.abovePct, "cases"));
    if (value === undefined || above === undefined) return { component: null };
    return {
      component: {
        id,
        type: "per_unit",
        lineId,
        rate: card.rateKind === "per_case" ? { kind: "per_case", amount: value } : { kind: "pct_of_value", bps: value },
        ...(above === null ? {} : { abovePct: above }),
        ...labels,
      },
    };
  }

  const leaves = card.leaves.map((l, i): LeafCondition | null => {
    if (l.kind === "line") {
      const lineId = req(`leaves.${i}.lineId`, l.lineId);
      const minPct = need(`leaves.${i}.minPct`, parseNumber(l.minPct, "cases"));
      return minPct === undefined ? null : { kind: "line_pct_at_least", lineId, minPct };
    }
    const focusItemId = req(`leaves.${i}.focusItemId`, l.focusItemId);
    const min = need(`leaves.${i}.min`, parseNumber(l.min, l.focusUnit));
    return min === undefined ? null : { kind: "focus_at_least", focusItemId, min };
  });
  if (card.leaves.length === 0) errors[`${id}.leaves`] = "required";
  const ready = leaves.every((l) => l !== null) && card.leaves.length > 0;
  const condition: Condition | null = !ready
    ? null
    : leaves.length === 1
      ? (leaves[0] as LeafCondition)
      : { kind: "all", conditions: leaves as LeafCondition[] };

  if (card.type === "bonus") {
    const amount = need("amount", parseNumber(card.amount, "value"));
    if (condition === null || amount === undefined) return { component: null };
    return { component: { id, type: "bonus", condition, amount, startsOn: card.startsOn, endsOn: card.endsOn, ...labels } };
  }

  if (card.appliesTo.length === 0) errors[`${id}.appliesTo`] = "required";
  if (condition === null || card.appliesTo.length === 0) return { component: null };
  return { component: { id, type: "gate", condition, appliesTo: [...card.appliesTo], ...labels } };
}

// ---- Server issues to fields ----

/**
 * The form field a server issue belongs to, in the same key form as `toComponents`' field errors
 * (`<cardId>.<field>`), or null when it is not about one card (for example `components` itself).
 */
export function issueFieldKey(cards: EditorCard[], issue: SchemeIssue): string | null {
  const m = /^components\.(\d+)(?:\.(.+))?$/.exec(issue.path);
  if (!m) return null;
  const card = cards[Number(m[1])];
  if (!card) return null;
  const rest = m[2] ?? "";
  const field = (() => {
    let r = /^tiers\.(\d+)\.pay(?:\..+)?$/.exec(rest);
    if (r) return `tiers.${r[1]}.pay`;
    if (/^rate(\..+)?$/.test(rest)) return "rate";
    r = /^condition\.conditions\.(\d+)\.(.+)$/.exec(rest);
    if (r) return `leaves.${r[1]}.${r[2]}`;
    if (rest === "condition.conditions" || rest === "condition") return "leaves";
    r = /^condition\.(.+)$/.exec(rest);
    if (r) return `leaves.0.${r[1]}`;
    if (rest === "startsOn" || rest === "endsOn") return "window";
    if (/^appliesTo(\..+)?$/.test(rest)) return "appliesTo";
    return rest;
  })();
  return field === "" ? card.id : `${card.id}.${field}`;
}

/** Card index of an issue, or null. */
export function issueCardIndex(issue: SchemeIssue): number | null {
  const m = /^components\.(\d+)/.exec(issue.path);
  return m ? Number(m[1]) : null;
}

/**
 * Whether the publish confirmation may be confirmed. A plan with parts needs only the dialog's
 * confirm button; a plan with none zeroes every rep's commission, so it also needs the explicit
 * "I understand" tick.
 */
export function canConfirmPublish(cardCount: number, understood: boolean): boolean {
  return cardCount > 0 || understood;
}
