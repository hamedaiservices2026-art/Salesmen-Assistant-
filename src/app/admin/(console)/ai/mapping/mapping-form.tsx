"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { ALIASES_PER_FIELD, ALIAS_MAX } from "@/domain/ai/aliases";
import { fieldBad, fieldInput, fieldOk, primaryButton, secondaryButton } from "@/ui/admin/form-styles";
import { saveMappingAction, type MappingFormState } from "./actions";

export type MappingField = { key: string; label: string; defaults: string[] };

/** A field's rows: what is saved (or was typed), and always one empty row to type in. */
function initialRows(saved: string[] | undefined): string[] {
  const rows = [...(saved ?? [])].slice(0, ALIASES_PER_FIELD);
  if (rows.length < ALIASES_PER_FIELD) rows.push("");
  return rows;
}

export function MappingForm({
  version,
  fields,
  aliases,
  justSaved,
}: {
  version: number;
  fields: MappingField[];
  aliases: Record<string, string[]>;
  justSaved: boolean;
}) {
  const t = useTranslations("admin.ai.mapping");
  const lead = useLocale() === "ur" ? "leading-[2.2]" : "";
  const [state, action, pending] = useActionState<MappingFormState, FormData>(saveMappingAction, {});
  const [rows, setRows] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(fields.map((f) => [f.key, initialRows(state.values?.[f.key] ?? aliases[f.key])])),
  );
  const nameOf = (f: MappingField) => (f.key.startsWith("line:") ? f.label : t(`keys.${f.key}`));
  const setRow = (key: string, i: number, value: string) =>
    setRows((r) => ({ ...r, [key]: (r[key] ?? []).map((v, j) => (j === i ? value : v)) }));
  const addRow = (key: string) =>
    setRows((r) => ((r[key] ?? []).length < ALIASES_PER_FIELD ? { ...r, [key]: [...(r[key] ?? []), ""] } : r));

  return (
    <form action={action} className={`flex flex-col gap-4 px-5 pb-5 ${lead}`}>
      <p className="m-0 text-[15px] text-ink-2">{t("intro")}</p>
      {justSaved && !state.errors && (
        <p role="status" className="m-0 rounded-lg bg-brand-tint px-4 py-3 text-[14.5px] text-brand">
          {t("saved")}
        </p>
      )}
      {state.errors?.form && (
        <p role="alert" className="m-0 rounded-lg bg-alert-tint px-4 py-3 text-[14.5px] text-alert">
          {t(`errors.${state.errors.form}`)}{" "}
          {state.errors.form === "stale" && (
            <Link href="/admin/ai/mapping" className="font-semibold underline">
              {t("reload")}
            </Link>
          )}
        </p>
      )}
      <input type="hidden" name="version" value={version} />
      <ul className="m-0 grid list-none grid-cols-2 items-start gap-4 p-0 max-[1180px]:grid-cols-1">
        {fields.map((f) => {
          const err = state.errors?.[f.key];
          const list = rows[f.key] ?? [""];
          const errId = `err-${f.key.replace(/[^a-z0-9]/gi, "_")}`;
          return (
            <li key={f.key} className="flex flex-col gap-2.5 rounded-lg border border-line px-4 py-3.5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="m-0 text-[15px] font-bold text-ink">
                  <bdi>{nameOf(f)}</bdi>
                </h3>
                <span className="text-[12.5px] text-ink-2">{t("builtIn")}</span>
              </div>
              <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0" aria-label={t("builtIn")}>
                {f.defaults.map((d) => (
                  <li key={d} className="rounded-full bg-canvas px-2.5 py-1 text-[13px] text-ink-2">
                    <bdi>{d}</bdi>
                  </li>
                ))}
              </ul>
              <div className="grid grid-cols-2 gap-2 max-[600px]:grid-cols-1">
                {list.map((value, i) => (
                  <input
                    key={i}
                    name={`alias:${f.key}`}
                    value={value}
                    onChange={(e) => setRow(f.key, i, e.currentTarget.value)}
                    maxLength={ALIAS_MAX * 2}
                    dir="auto"
                    autoComplete="off"
                    aria-label={t("aliasLabel", { field: nameOf(f), n: i + 1 })}
                    placeholder={t("placeholder")}
                    aria-invalid={err ? true : undefined}
                    aria-describedby={err ? errId : undefined}
                    className={`${fieldInput} ${err ? fieldBad : fieldOk}`}
                  />
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-3">
                {list.length < ALIASES_PER_FIELD && (
                  <button type="button" onClick={() => addRow(f.key)} className={secondaryButton}>
                    <Plus aria-hidden="true" size={18} strokeWidth={2} />
                    {t("addAnother")}
                  </button>
                )}
                {err && (
                  <span id={errId} role="alert" className="text-[13px] text-alert">
                    {t(`errors.${err}`, { max: ALIAS_MAX, count: ALIASES_PER_FIELD })}
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap justify-end gap-3">
        <button type="submit" disabled={pending} className={primaryButton}>
          {pending ? t("saving") : t("save")}
        </button>
      </div>
    </form>
  );
}
