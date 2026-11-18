"use client";

import { useTranslations } from "next-intl";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import type { Unit } from "@/domain/money";
import { ConditionRows, type FocusOpt, type LineOpt } from "./ConditionRows";
import { TierRows } from "./TierRows";
import {
  addLeaf,
  allowsPct,
  removeLeaf,
  setLeaf,
  setLeafFocus,
  setLeafKind,
  setLine,
  type EditorCard,
  type FormRefs,
  type Preset,
} from "./scheme-form";
import { fieldBad, fieldInput, fieldLabel, fieldOk, iconButton, type FieldState } from "./form-styles";

const LEAF_KINDS: Record<Preset, readonly ("line" | "focus")[]> = {
  tiers: [],
  rate: [],
  coverage: [],
  bonus: ["line"],
  extra100: ["line"],
  volume: ["focus"],
  combined: ["line", "focus"],
  gate: ["line", "focus"],
};

/** One scheme component: its presets' fields, labels in three languages, and its own problems. */
export function ComponentCard({
  card,
  index,
  count,
  refs,
  lines,
  focus,
  others,
  currencyLabel,
  unitLabels,
  state,
  problems,
  onChange,
  onMove,
  onRemove,
}: {
  card: EditorCard;
  index: number;
  count: number;
  refs: FormRefs;
  lines: LineOpt[];
  focus: FocusOpt[];
  /** The other cards a gate may hold back: id and name. */
  others: { id: string; name: string }[];
  currencyLabel: string;
  unitLabels: Record<Unit, string>;
  state: FieldState;
  /** Messages for this card's server issues. */
  problems: string[];
  onChange: (card: EditorCard) => void;
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
}) {
  const t = useTranslations("admin.schemes");
  const tf = useTranslations("admin.schemes.fieldErrors");
  const base = `card-${card.id}`;
  const box = (field: string) => (state(field).invalid ? fieldBad : fieldOk);
  const msg = (field: string) => {
    const m = state(field).message;
    return m ? <span className="mt-1 block text-[12.5px] text-alert">{tf(m as "required" | "invalid")}</span> : null;
  };
  const kinds = LEAF_KINDS[card.preset];
  const line = lines.find((l) => l.id === card.lineId);
  const lineChoices =
    card.type === "tiered" ? lines.filter((l) => (card.preset === "coverage") === (refs.lines.find((r) => r.id === l.id)?.kind === "coverage")) : lines;
  const lineSelect = (
    <div className="min-w-48 max-w-96">
      <label className={fieldLabel} htmlFor={`${base}-line`}>
        {t("card.line")}
      </label>
      <select
        id={`${base}-line`}
        value={card.lineId}
        onChange={(e) => onChange(setLine(card, e.target.value, refs))}
        aria-invalid={state("lineId").invalid || undefined}
        className={`${fieldInput} ${box("lineId")}`}
      >
        <option value="">{t("card.chooseLine")}</option>
        {card.lineId !== "" && !lines.some((l) => l.id === card.lineId) && <option value={card.lineId}>{t("card.unknownLine")}</option>}
        {lineChoices.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
          </option>
        ))}
      </select>
      {msg("lineId")}
    </div>
  );

  return (
    <section
      id={base}
      aria-label={`${index + 1}. ${t(`presets.${card.preset}.name`)}`}
      className={`flex min-w-0 flex-col gap-4 rounded-[14px] border bg-white p-5 ${problems.length > 0 ? "border-alert" : "border-line"}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="inline-flex size-8 items-center justify-center rounded-full bg-brand-tint text-[14px] font-bold tabular-nums text-brand">
            {index + 1}
          </span>
          <h3 className="m-0 text-[16px] font-bold text-ink">{t(`presets.${card.preset}.name`)}</h3>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => onMove(-1)} disabled={index === 0} aria-label={t("card.moveUp")} title={t("card.moveUp")} className={iconButton}>
            <ArrowUp size={18} strokeWidth={1.8} aria-hidden />
          </button>
          <button type="button" onClick={() => onMove(1)} disabled={index === count - 1} aria-label={t("card.moveDown")} title={t("card.moveDown")} className={iconButton}>
            <ArrowDown size={18} strokeWidth={1.8} aria-hidden />
          </button>
          <button type="button" onClick={onRemove} aria-label={t("card.remove")} title={t("card.remove")} className={iconButton}>
            <Trash2 size={18} strokeWidth={1.8} aria-hidden />
          </button>
        </div>
      </div>

      {problems.length > 0 && (
        <ul role="alert" className="m-0 flex list-none flex-col gap-1 rounded-lg bg-alert-tint px-3 py-2.5 text-[13.5px] text-alert">
          {problems.map((p, i) => (
            <li key={i}>{p}</li>
          ))}
        </ul>
      )}

      <fieldset className="m-0 min-w-0 border-0 p-0">
        <legend className="mb-1.5 p-0 text-[14.5px] font-bold text-ink">{t("card.labelsTitle")}</legend>
        <div className="grid grid-cols-3 gap-3 max-[1300px]:grid-cols-1">
          {(["ar", "en", "ur"] as const).map((code) => (
            <div key={code}>
              <label className={fieldLabel} htmlFor={`${base}-label-${code}`}>
                {t(`card.label${code === "ar" ? "Ar" : code === "en" ? "En" : "Ur"}`)}
              </label>
              <input
                id={`${base}-label-${code}`}
                value={card.label[code]}
                onChange={(e) => onChange({ ...card, label: { ...card.label, [code]: e.target.value } })}
                lang={code}
                dir={code === "en" ? "ltr" : "rtl"}
                maxLength={200}
                autoComplete="off"
                aria-invalid={code === "ar" && state("label").invalid ? true : undefined}
                className={`${fieldInput} ${code === "ar" ? box("label") : fieldOk}`}
              />
              {code === "ar" && msg("label")}
            </div>
          ))}
        </div>
      </fieldset>

      {card.type === "tiered" && (
        <>
          {lineSelect}
          <TierRows
            idBase={base}
            tiers={card.tiers}
            allowPct={allowsPct(refs, card.lineId)}
            currencyLabel={currencyLabel}
            state={state}
            onChange={(tiers) => onChange({ ...card, tiers })}
          />
        </>
      )}

      {card.type === "per_unit" && (
        <>
          {lineSelect}
          {line && (
            <p className="m-0 text-[13px] text-ink-2">{card.rateKind === "per_case" ? t("card.rate.perCaseNote") : t("card.rate.pctNote")}</p>
          )}
          <div className="flex flex-wrap items-start gap-3">
            <div className="w-56">
              <label className={fieldLabel} htmlFor={`${base}-rate`}>
                {card.rateKind === "per_case" ? t("card.rate.perCase", { currency: currencyLabel }) : t("card.rate.pct")}
              </label>
              <input
                id={`${base}-rate`}
                value={card.rateValue}
                onChange={(e) => onChange({ ...card, rateValue: e.target.value })}
                inputMode="decimal"
                autoComplete="off"
                dir="ltr"
                aria-invalid={state("rate").invalid || undefined}
                className={`${fieldInput} text-end tabular-nums ${box("rate")}`}
              />
              {msg("rate")}
            </div>
            <div className="w-56">
              <label className={fieldLabel} htmlFor={`${base}-above`}>
                {t("card.rate.above")}
              </label>
              <input
                id={`${base}-above`}
                value={card.abovePct}
                onChange={(e) => onChange({ ...card, abovePct: e.target.value })}
                inputMode="numeric"
                autoComplete="off"
                dir="ltr"
                aria-invalid={state("abovePct").invalid || undefined}
                className={`${fieldInput} text-end tabular-nums ${box("abovePct")}`}
              />
              {msg("abovePct")}
              <span className="mt-1 block text-[12.5px] text-ink-2">{t("card.rate.aboveHint")}</span>
            </div>
          </div>
        </>
      )}

      {(card.type === "bonus" || card.type === "gate") && (
        <>
          {card.preset === "volume" && focus.length === 0 && <p className="m-0 text-[13.5px] text-ink-2">{t("card.noFocus")}</p>}
          <ConditionRows
            idBase={base}
            leaves={card.leaves}
            kinds={kinds}
            minRows={card.preset === "combined" ? 2 : 1}
            canAdd={card.preset !== "volume" && card.leaves.length < 4}
            lines={lines}
            focus={focus}
            unitLabels={unitLabels}
            state={state}
            onSetKind={(i, kind) => onChange(setLeafKind(card, i, kind, refs))}
            onSetLeaf={(i, patch) => onChange(setLeaf(card, i, patch, refs))}
            onSetFocus={(i, id) => onChange(setLeafFocus(card, i, id, refs))}
            onAdd={(kind) => onChange(addLeaf(card, kind, refs))}
            onRemove={(i) => onChange(removeLeaf(card, i, refs))}
          />
        </>
      )}

      {card.type === "bonus" && (
        <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
          <div className="w-56">
            <label className={fieldLabel} htmlFor={`${base}-amount`}>
              {t("card.amount", { currency: currencyLabel })}
            </label>
            <input
              id={`${base}-amount`}
              value={card.amount}
              onChange={(e) => onChange({ ...card, amount: e.target.value })}
              inputMode="decimal"
              autoComplete="off"
              dir="ltr"
              aria-invalid={state("amount").invalid || undefined}
              className={`${fieldInput} text-end tabular-nums ${box("amount")}`}
            />
            {msg("amount")}
          </div>
          <div className="min-w-48 flex-1">
            <span className={fieldLabel}>{t("card.window.title")}</span>
            <p className={`m-0 flex min-h-11 flex-wrap items-center gap-x-3 rounded-lg px-3 py-2 text-[14px] ${state("window").invalid ? "bg-alert-tint text-alert" : "bg-canvas text-ink"}`}>
              <bdi dir="ltr" className="font-semibold tabular-nums">
                {card.startsOn}
              </bdi>
              <span aria-hidden>–</span>
              <bdi dir="ltr" className="font-semibold tabular-nums">
                {card.endsOn}
              </bdi>
            </p>
            <span className="mt-1 block text-[12.5px] text-ink-2">
              {card.leaves.some((l) => l.kind === "focus") ? t("card.window.focus") : t("card.window.whole")}
            </span>
          </div>
        </div>
      )}

      {card.type === "gate" && (
        <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
          <legend className="mb-1 p-0 text-[14.5px] font-bold text-ink">{t("card.gate.appliesTo")}</legend>
          {others.length === 0 ? (
            <p className="m-0 text-[13.5px] text-ink-2">{t("card.gate.none")}</p>
          ) : (
            <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
              {others.map((o) => {
                const on = card.appliesTo.includes(o.id);
                return (
                  <li key={o.id}>
                    <label className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-[10px] border px-3 text-[14px] ${on ? "border-brand bg-brand-tint font-semibold text-brand" : "border-line bg-white text-ink"}`}>
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() =>
                          onChange({ ...card, appliesTo: on ? card.appliesTo.filter((a) => a !== o.id) : [...card.appliesTo, o.id] })
                        }
                        className="size-4 accent-brand"
                      />
                      {o.name}
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          {msg("appliesTo")}
        </fieldset>
      )}
    </section>
  );
}
