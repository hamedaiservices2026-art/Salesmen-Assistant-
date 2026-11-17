"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { saveTargetsAction, type TargetFormState } from "./actions";

export type GridColumn = { lineId: string; name: string; unitText: string };
export type GridRow = { id: string; name: string; login: string };

const primaryButton =
  "inline-flex min-h-11 items-center justify-center rounded-[10px] bg-brand px-5 text-[14.5px] font-semibold text-white hover:bg-brand-hover disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";

/**
 * The reps by lines grid, one form, one save. `cells` holds each cell's stored amount already
 * formatted like the rep app shows it (empty text for no target); a refused save puts back exactly
 * what was typed.
 */
export function TargetGrid({
  ym,
  columns,
  rows,
  cells,
}: {
  ym: string;
  columns: GridColumn[];
  rows: GridRow[];
  cells: Record<string, string>;
}) {
  const t = useTranslations("admin.targets");
  const [state, action, pending] = useActionState<TargetFormState, FormData>(saveTargetsAction, {});
  const errors = state.errors ?? {};
  const hasErrors = Object.keys(errors).length > 0;
  // Stored amounts changed (a save, or another admin's): start the inputs again from them.
  const version = Object.entries(cells)
    .map(([k, v]) => `${k}=${v}`)
    .join(";");

  return (
    <form key={`${ym}|${version}`} action={action} className="flex flex-col gap-4 pb-5">
      <input type="hidden" name="ym" value={ym} />
      <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={t("gridTitle", { month: ym })}>
        <table className="w-max min-w-full border-separate border-spacing-0 text-[14.5px]">
          <thead>
            <tr>
              <th
                scope="col"
                className="sticky start-0 z-10 min-w-44 border-b border-line bg-white px-5 py-3 text-start text-[13px] font-semibold text-ink-2"
              >
                {t("repCol")}
              </th>
              {columns.map((c) => (
                <th key={c.lineId} scope="col" className="min-w-40 border-b border-line px-3 py-3 text-start">
                  <span className="block text-[14px] font-bold text-ink">{c.name}</span>
                  <span className="block text-[12.5px] font-normal text-ink-2">{c.unitText}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <th
                  scope="row"
                  className="sticky start-0 z-10 border-b border-line bg-white px-5 py-2 text-start font-semibold text-ink"
                >
                  <span className="block">{r.name}</span>
                  <span className="block text-[12.5px] font-normal text-ink-2" dir="ltr">
                    {r.login}
                  </span>
                </th>
                {columns.map((c) => {
                  const key = `${r.id}|${c.lineId}`;
                  const error = errors[key];
                  const errorId = `err-${r.id}-${c.lineId}`;
                  return (
                    <td key={c.lineId} className="border-b border-line px-3 py-2 align-top">
                      <input
                        name={`c:${key}`}
                        defaultValue={state.values?.[key] ?? cells[key] ?? ""}
                        inputMode="decimal"
                        autoComplete="off"
                        dir="ltr"
                        placeholder={t("placeholder")}
                        aria-label={t("cellLabel", { rep: r.name, line: c.name })}
                        aria-invalid={error ? true : undefined}
                        aria-describedby={error ? errorId : undefined}
                        className={`block min-h-11 w-full rounded-lg border bg-white px-3 text-end text-[15px] tabular-nums text-ink placeholder:text-muted focus:border-brand focus:outline-2 focus:outline-brand ${
                          error ? "border-alert bg-alert-tint" : "border-line"
                        }`}
                      />
                      {error && (
                        <span id={errorId} role="alert" className="mt-1 block text-[12.5px] text-alert">
                          {t(`errors.${error}`)}
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-4 px-5">
        <button type="submit" disabled={pending} className={primaryButton}>
          {pending ? t("saving") : t("save")}
        </button>
        {hasErrors && (
          <p role="alert" className="m-0 text-[14px] text-alert">
            {errors.period ? t("errors.period") : t("errorsSummary")}
          </p>
        )}
        {!hasErrors && state.changed !== undefined && (
          <p role="status" className="m-0 text-[14px] text-ink-2">
            {t("saved", { count: state.changed })}
          </p>
        )}
      </div>
    </form>
  );
}
