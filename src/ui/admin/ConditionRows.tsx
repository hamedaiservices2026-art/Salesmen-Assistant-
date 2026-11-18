"use client";

import { useTranslations } from "next-intl";
import { Plus, Trash2 } from "lucide-react";
import type { Unit } from "@/domain/money";
import type { LeafRow } from "./scheme-form";
import { fieldBad, fieldInput, fieldLabel, fieldOk, iconButton, secondaryButton, type FieldState } from "./form-styles";

export type LineOpt = { id: string; name: string; unit: Unit };
export type FocusOpt = { id: string; name: string; unit: Unit };

/**
 * The conditions of a bonus or a gate: one row is a plain condition, two or more are joined by "and".
 * A row is either a line's achievement percent or a focus item's quantity.
 */
export function ConditionRows({
  idBase,
  leaves,
  kinds,
  minRows,
  canAdd,
  lines,
  focus,
  unitLabels,
  state,
  onSetKind,
  onSetLeaf,
  onSetFocus,
  onAdd,
  onRemove,
}: {
  idBase: string;
  leaves: LeafRow[];
  /** Row kinds the card's preset offers. */
  kinds: readonly ("line" | "focus")[];
  minRows: number;
  canAdd: boolean;
  lines: LineOpt[];
  focus: FocusOpt[];
  unitLabels: Record<Unit, string>;
  state: FieldState;
  onSetKind: (i: number, kind: "line" | "focus") => void;
  onSetLeaf: (i: number, patch: Partial<LeafRow>) => void;
  onSetFocus: (i: number, focusItemId: string) => void;
  onAdd: (kind: "line" | "focus") => void;
  onRemove: (i: number) => void;
}) {
  const t = useTranslations("admin.schemes.card");
  const tf = useTranslations("admin.schemes.fieldErrors");
  const box = (field: string) => (state(field).invalid ? fieldBad : fieldOk);
  const msg = (field: string) => {
    const m = state(field).message;
    return m ? <span className="mt-1 block text-[12.5px] text-alert">{tf(m as "required" | "invalid")}</span> : null;
  };
  // A row of a kind the preset does not offer (a loaded plan) still shows, with the kind picker.
  const rowKinds = (l: LeafRow) => (kinds.includes(l.kind) ? kinds : [...kinds, l.kind]);

  return (
    <fieldset className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0">
      <legend className="mb-1 p-0 text-[14.5px] font-bold text-ink">{t("conditions.title")}</legend>
      {msg("leaves")}
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {leaves.map((l, i) => {
          const item = focus.find((f) => f.id === l.focusItemId);
          const unitText = unitLabels[item?.unit ?? l.focusUnit];
          const kindsHere = rowKinds(l);
          return (
            <li key={i} className="flex flex-col gap-2">
              {i > 0 && (
                <span className="self-start rounded-full bg-brand-tint px-3 py-0.5 text-[13px] font-bold text-brand">
                  {t("conditions.and")}
                </span>
              )}
              <div className="flex flex-wrap items-start gap-3 rounded-xl bg-canvas p-3">
                {kindsHere.length > 1 && (
                  <div className="w-44 shrink-0">
                    <label className={fieldLabel} htmlFor={`${idBase}-leaf-${i}-kind`}>
                      {t("conditions.kind")}
                    </label>
                    <select
                      id={`${idBase}-leaf-${i}-kind`}
                      value={l.kind}
                      onChange={(e) => onSetKind(i, e.target.value as "line" | "focus")}
                      className={`${fieldInput} ${fieldOk}`}
                    >
                      {kindsHere.map((k) => (
                        <option key={k} value={k}>
                          {k === "line" ? t("conditions.kindLine") : t("conditions.kindFocus")}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                {l.kind === "line" ? (
                  <>
                    <div className="min-w-40 flex-1">
                      <label className={fieldLabel} htmlFor={`${idBase}-leaf-${i}-line`}>
                        {t("line")}
                      </label>
                      <select
                        id={`${idBase}-leaf-${i}-line`}
                        value={l.lineId}
                        onChange={(e) => onSetLeaf(i, { lineId: e.target.value })}
                        aria-invalid={state(`leaves.${i}.lineId`).invalid || undefined}
                        className={`${fieldInput} ${box(`leaves.${i}.lineId`)}`}
                      >
                        <option value="">{t("chooseLine")}</option>
                        {l.lineId !== "" && !lines.some((x) => x.id === l.lineId) && <option value={l.lineId}>{t("unknownLine")}</option>}
                        {lines.map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.name}
                          </option>
                        ))}
                      </select>
                      {msg(`leaves.${i}.lineId`)}
                    </div>
                    <div className="w-36 shrink-0">
                      <label className={fieldLabel} htmlFor={`${idBase}-leaf-${i}-pct`}>
                        {t("conditions.minPct")}
                      </label>
                      <input
                        id={`${idBase}-leaf-${i}-pct`}
                        value={l.minPct}
                        onChange={(e) => onSetLeaf(i, { minPct: e.target.value })}
                        inputMode="numeric"
                        autoComplete="off"
                        dir="ltr"
                        aria-invalid={state(`leaves.${i}.minPct`).invalid || undefined}
                        className={`${fieldInput} text-end tabular-nums ${box(`leaves.${i}.minPct`)}`}
                      />
                      {msg(`leaves.${i}.minPct`)}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="min-w-40 flex-1">
                      <label className={fieldLabel} htmlFor={`${idBase}-leaf-${i}-item`}>
                        {t("conditions.focusItem")}
                      </label>
                      <select
                        id={`${idBase}-leaf-${i}-item`}
                        value={l.focusItemId}
                        onChange={(e) => onSetFocus(i, e.target.value)}
                        aria-invalid={state(`leaves.${i}.focusItemId`).invalid || undefined}
                        className={`${fieldInput} ${box(`leaves.${i}.focusItemId`)}`}
                      >
                        <option value="">{t("chooseFocus")}</option>
                        {l.focusItemId !== "" && !item && <option value={l.focusItemId}>{t("unknownFocus")}</option>}
                        {focus.map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.name}
                          </option>
                        ))}
                      </select>
                      {msg(`leaves.${i}.focusItemId`)}
                    </div>
                    <div className="w-44 shrink-0">
                      <label className={fieldLabel} htmlFor={`${idBase}-leaf-${i}-min`}>
                        {t("conditions.focusMin", { unit: unitText })}
                      </label>
                      <input
                        id={`${idBase}-leaf-${i}-min`}
                        value={l.min}
                        onChange={(e) => onSetLeaf(i, { min: e.target.value })}
                        inputMode="decimal"
                        autoComplete="off"
                        dir="ltr"
                        aria-invalid={state(`leaves.${i}.min`).invalid || undefined}
                        className={`${fieldInput} text-end tabular-nums ${box(`leaves.${i}.min`)}`}
                      />
                      {msg(`leaves.${i}.min`)}
                    </div>
                  </>
                )}
                {leaves.length > minRows && (
                  <button
                    type="button"
                    onClick={() => onRemove(i)}
                    aria-label={t("conditions.remove")}
                    title={t("conditions.remove")}
                    className={`${iconButton} mt-6`}
                  >
                    <Trash2 size={18} strokeWidth={1.8} aria-hidden />
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {canAdd && (
        <div className="flex flex-wrap gap-2">
          {kinds.map((k) => (
            <button key={k} type="button" onClick={() => onAdd(k)} className={secondaryButton}>
              <Plus size={18} strokeWidth={1.8} aria-hidden />
              {kinds.length > 1
                ? `${t("conditions.add")}: ${k === "line" ? t("conditions.kindLine") : t("conditions.kindFocus")}`
                : t("conditions.add")}
            </button>
          ))}
        </div>
      )}
    </fieldset>
  );
}
