"use client";

import { useActionState } from "react";
import { CircleCheck, Download, TriangleAlert, Upload } from "lucide-react";
import { useTranslations } from "next-intl";
import { Card } from "@/ui/admin/Card";
import { fieldInput, fieldLabel, primaryButton, secondaryButton } from "@/ui/admin/form-styles";
import { uploadAction, type UploadState } from "./actions";

/** Most error rows shown; the report says how many more there are. */
export const SHOWN_ERRORS = 100;

const COLUMNS = {
  targets: ["login", "year", "month", "line", "amount"],
  daily: ["login", "date", "line", "amount"],
} as const;

export function UploadCard({ kind }: { kind: "targets" | "daily" }) {
  const t = useTranslations("admin.uploads");
  const [state, action, pending] = useActionState<UploadState, FormData>(uploadAction, {});
  const mine = state.kind === kind ? state : undefined;
  const result = mine?.result;
  const shown = result?.errors.slice(0, SHOWN_ERRORS) ?? [];
  const more = result ? result.errorCount - shown.length : 0;
  const columns = (names: string[] | undefined) => (names ?? []).join("، ");

  const readError = result?.readError
    ? t(`readErrors.${result.readError}`, { columns: columns(result.missing ?? result.duplicates) })
    : null;

  return (
    <Card title={t(`${kind}.title`)} className="flex flex-col">
      <form action={action} className="flex flex-col gap-4 px-5 pb-5">
        <input type="hidden" name="kind" value={kind} />
        <p className="m-0 text-[14px] leading-relaxed text-ink-2">{t(`${kind}.hint`)}</p>
        <p className="m-0 text-[13.5px] text-ink-2">
          {t("columnsLabel")}:{" "}
          <bdi dir="ltr" className="font-semibold text-ink">
            {COLUMNS[kind].join(", ")}
          </bdi>
        </p>
        <div>
          <a href={`/admin/uploads/template/${kind}`} download className={secondaryButton}>
            <Download size={18} strokeWidth={1.8} aria-hidden />
            {t("template")}
          </a>
        </div>
        <div>
          <label htmlFor={`file-${kind}`} className={fieldLabel}>
            {t("fileLabel")}
          </label>
          <input
            id={`file-${kind}`}
            name="file"
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            required
            className={`${fieldInput} py-2`}
          />
          <p className="m-0 mt-1.5 text-[13px] text-ink-2">{t("limits")}</p>
          {kind === "daily" && <p className="m-0 mt-1 text-[13px] text-ink-2">{t("dateNote")}</p>}
        </div>
        <div>
          <button type="submit" disabled={pending} className={primaryButton}>
            <Upload size={18} strokeWidth={1.8} aria-hidden />
            {pending ? t("submitting") : t("submit")}
          </button>
        </div>

        <div aria-live="polite" className="flex flex-col gap-3">
          {mine?.failure && (
            <p role="alert" className="m-0 flex items-center gap-2 rounded-xl bg-alert-tint px-3.5 py-2.5 text-[14px] font-bold text-alert">
              <TriangleAlert size={18} strokeWidth={2} aria-hidden className="shrink-0" />
              {t(`failures.${mine.failure}`)}
            </p>
          )}
          {result?.applied && (
            <p className="m-0 flex items-center gap-2 rounded-xl bg-brand-tint px-3.5 py-2.5 text-[14.5px] font-bold text-brand">
              <CircleCheck size={18} strokeWidth={2} aria-hidden className="shrink-0" />
              {t("result.applied", { count: result.rows })}
            </p>
          )}
          {result && !result.applied && (
            <div role="alert" className="flex flex-col gap-1 rounded-xl bg-alert-tint px-3.5 py-2.5 text-alert">
              <p className="m-0 flex items-center gap-2 text-[14.5px] font-bold">
                <TriangleAlert size={18} strokeWidth={2} aria-hidden className="shrink-0" />
                {t("result.notApplied")}
              </p>
              {readError ? (
                <p className="m-0 text-[14px]">{readError}</p>
              ) : (
                <p className="m-0 text-[14px]">{t("result.notAppliedHint", { count: result.errorCount })}</p>
              )}
            </div>
          )}
          {result && !result.applied && shown.length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-line" tabIndex={0} role="region" aria-label={t("result.tableLabel")}>
              <table className="w-full border-collapse text-[14px]">
                <thead>
                  <tr className="border-b border-line bg-canvas text-[13px] text-ink-2">
                    {(["row", "column", "reason"] as const).map((c) => (
                      <th key={c} scope="col" className="whitespace-nowrap px-3 py-2 text-start font-semibold">
                        {t(`result.${c}`)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {shown.map((e, i) => (
                    <tr key={i} className="border-b border-line last:border-b-0 align-top">
                      <td className="whitespace-nowrap px-3 py-2 font-semibold tabular-nums text-ink">{e.row > 0 ? e.row : "–"}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-ink-2" dir="ltr">
                        {e.column ? t(`columns.${e.column as "login"}`) : t("result.noColumn")}
                      </td>
                      <td className="px-3 py-2 text-ink">{t(`reasons.${e.code}`)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {result && !result.applied && more > 0 && <p className="m-0 text-[13.5px] font-semibold text-ink-2">{t("result.more", { count: more })}</p>}
        </div>
      </form>
    </Card>
  );
}
