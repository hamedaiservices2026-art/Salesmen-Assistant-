"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { ArrowDown, ArrowUp } from "lucide-react";
import { lineName, type LineKind } from "@/domain/lines";
import type { Unit } from "@/domain/money";
import type { Locale } from "@/i18n/config";
import {
  moveLineAction,
  saveLineAction,
  setLineActiveAction,
  type LineFormState,
  type LineRowState,
} from "./actions";

export type LineView = {
  lineId: string;
  code: string;
  nameAr: string;
  nameEn: string;
  nameUr: string;
  unit: Unit;
  kind: LineKind;
  sort: number;
  active: boolean;
  inUse: boolean;
};

const KINDS = ["sales", "collection", "coverage"] as const satisfies readonly LineKind[];
/** The units each kind may use: a collection is always value, a coverage is always outlets. */
const UNITS_OF: Record<LineKind, readonly Unit[]> = {
  sales: ["cases", "value"],
  collection: ["value"],
  coverage: ["outlets"],
};

const input =
  "block min-h-11 w-full rounded-lg border border-line bg-white px-3 text-[15px] text-ink focus:border-brand focus:outline-2 focus:outline-brand disabled:bg-canvas disabled:text-ink-2";
const primaryButton =
  "inline-flex min-h-11 items-center justify-center rounded-[10px] bg-brand px-5 text-[14.5px] font-semibold text-white hover:bg-brand-hover disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";
const secondaryButton =
  "inline-flex min-h-11 items-center justify-center gap-1.5 whitespace-nowrap rounded-[10px] border border-line bg-white px-3.5 text-[14px] font-semibold text-brand hover:bg-brand-tint disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";
const label = "mb-1.5 block text-sm font-medium text-ink-2";

export function LineForm({ line }: { line: LineView | null }) {
  const t = useTranslations("admin.lines");
  const [state, action, pending] = useActionState<LineFormState, FormData>(saveLineAction, {});
  const v = state.values ?? {};
  const initialKind = (v.kind ?? line?.kind ?? "sales") as LineKind;
  const [kind, setKind] = useState<LineKind>(KINDS.includes(initialKind) ? initialKind : "sales");
  const units = UNITS_OF[kind];
  const wantedUnit = (v.unit ?? line?.unit ?? "cases") as Unit;
  const unit = units.includes(wantedUnit) ? wantedUnit : units[0]!;
  const locked = line?.inUse ?? false;
  const created = state.saved && !line;

  const err = (field: string) => (state.errors?.[field] ? t(`errors.${state.errors[field]}`) : undefined);
  const error = (field: string) =>
    err(field) && (
      <span id={`${field}-error`} role="alert" className="mt-1 block text-[13px] text-alert">
        {err(field)}
      </span>
    );
  const aria = (field: string) => ({
    "aria-invalid": err(field) ? (true as const) : undefined,
    "aria-describedby": err(field) ? `${field}-error` : undefined,
  });
  // A value the admin typed survives a refusal; otherwise the line's own, or empty for a new one.
  const val = (field: "code" | "nameAr" | "nameEn" | "nameUr") => v[field] ?? line?.[field] ?? "";

  return (
    <form
      // A saved new line clears the form: the key changes so the inputs start empty again.
      key={created ? "created" : "form"}
      action={action}
      className="flex flex-col gap-4 px-5 pb-5"
    >
      {state.saved && (
        <p role="status" className="m-0 rounded-lg bg-brand-tint px-4 py-3 text-[14.5px] text-brand">
          {t("saved")}
        </p>
      )}
      {line && <input type="hidden" name="id" value={line.lineId} />}
      <div className="grid grid-cols-3 items-start gap-4 max-[900px]:grid-cols-1">
        <label className="block">
          <span className={label}>{t("fields.nameAr")}</span>
          <input name="nameAr" required lang="ar" dir="rtl" maxLength={80} defaultValue={val("nameAr")} className={input} {...aria("nameAr")} />
          {error("nameAr")}
        </label>
        <label className="block">
          <span className={label}>{t("fields.nameEn")}</span>
          <input name="nameEn" lang="en" dir="ltr" maxLength={80} defaultValue={val("nameEn")} className={input} {...aria("nameEn")} />
          {error("nameEn")}
        </label>
        <label className="block">
          <span className={label}>{t("fields.nameUr")}</span>
          <input name="nameUr" lang="ur" dir="rtl" maxLength={80} defaultValue={val("nameUr")} className={input} {...aria("nameUr")} />
          {error("nameUr")}
        </label>
      </div>
      <div className="grid grid-cols-3 items-start gap-4 max-[900px]:grid-cols-1">
        <label className="block">
          <span className={label}>{t("fields.code")}</span>
          <input
            name="code"
            required
            dir="ltr"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={32}
            readOnly={locked}
            defaultValue={val("code")}
            className={`${input} ${locked ? "bg-canvas text-ink-2" : ""}`}
            {...aria("code")}
          />
          {error("code") ?? <span className="mt-1 block text-[13px] text-ink-2">{t("fields.codeHint")}</span>}
        </label>
        <label className="block">
          <span className={label}>{t("fields.kind")}</span>
          <select
            name="kind"
            value={kind}
            onChange={(e) => setKind(e.currentTarget.value as LineKind)}
            disabled={locked}
            className={input}
            {...aria("kind")}
          >
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`kinds.${k}`)}
              </option>
            ))}
          </select>
          {locked && <input type="hidden" name="kind" value={kind} />}
          {error("kind")}
        </label>
        <label className="block">
          <span className={label}>{t("fields.unit")}</span>
          <select key={kind} name="unit" defaultValue={unit} disabled={locked} className={input} {...aria("unit")}>
            {units.map((u) => (
              <option key={u} value={u}>
                {t(`units.${u}`)}
              </option>
            ))}
          </select>
          {locked && <input type="hidden" name="unit" value={unit} />}
          {error("unit")}
        </label>
      </div>
      {error("active")}
      {locked && (
        <p className="m-0 text-[13.5px] text-ink-2">{t("fields.lockedHint")}</p>
      )}
      <div className="flex flex-wrap gap-3">
        <button type="submit" disabled={pending} className={primaryButton}>
          {line ? t("form.saveEdit") : t("form.saveNew")}
        </button>
        {line && (
          <Link href="/admin/lines" className={secondaryButton}>
            {t("form.cancel")}
          </Link>
        )}
      </div>
    </form>
  );
}

function RowButton({
  action,
  id,
  label: text,
  extra,
  disabled,
  children,
}: {
  action: (form: FormData) => void;
  id: string;
  label: string;
  extra: Record<string, string>;
  disabled?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      {Object.entries(extra).map(([k, val]) => (
        <input key={k} type="hidden" name={k} value={val} />
      ))}
      <button type="submit" disabled={disabled} aria-label={children ? text : undefined} className={secondaryButton}>
        {children ?? text}
      </button>
    </form>
  );
}

export function LineTable({ rows }: { rows: LineView[] }) {
  const t = useTranslations("admin.lines");
  const locale = useLocale() as Locale;
  const [toggled, toggle, toggling] = useActionState<LineRowState, FormData>(setLineActiveAction, {});
  const [moved, move, moving] = useActionState<LineRowState, FormData>(moveLineAction, {});
  const error = toggled.error ?? moved.error;
  const th = "px-4 py-2.5 text-start text-[13px] font-semibold text-ink-2";
  const isolate = (name: string) => `⁨${name}⁩`;

  if (rows.length === 0) return <p className="m-0 border-t border-line-soft px-5 py-6 text-[14.5px] text-ink-2">{t("empty")}</p>;
  return (
    <div className="flex flex-col gap-4">
      {error && (
        <p role="alert" className="m-0 mx-5 rounded-lg bg-alert-tint px-4 py-3 text-[14.5px] text-alert">
          {t(`errors.row_${error}`)}
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[14.5px]">
          <thead>
            <tr className="bg-canvas">
              <th scope="col" className={th}>{t("cols.name")}</th>
              <th scope="col" className={th}>{t("cols.code")}</th>
              <th scope="col" className={th}>{t("cols.kind")}</th>
              <th scope="col" className={th}>{t("cols.unit")}</th>
              <th scope="col" className={th}>{t("cols.status")}</th>
              <th scope="col" className={th}>
                <span className="sr-only">{t("cols.actions")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((l, i) => (
              <tr key={l.lineId} className="border-t border-line-soft align-middle">
                <th scope="row" className="px-4 py-2.5 text-start font-semibold text-ink">
                  <bdi>{lineName(l, locale)}</bdi>
                </th>
                <td className="px-4 py-2.5 text-ink-2" dir="ltr">
                  <span className="block text-start">{l.code}</span>
                </td>
                <td className="px-4 py-2.5">{t(`kinds.${l.kind}`)}</td>
                <td className="px-4 py-2.5">{t(`units.${l.unit}`)}</td>
                <td className="px-4 py-2.5">
                  <span
                    className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-1 text-[13px] font-semibold ${
                      l.active ? "bg-brand-tint text-brand" : "border border-line bg-white text-ink-2"
                    }`}
                  >
                    {l.active ? t("status.active") : t("status.inactive")}
                  </span>
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex flex-wrap justify-end gap-2">
                    <RowButton action={move} id={l.lineId} extra={{ direction: "up" }} label={t("actions.moveUp", { name: isolate(lineName(l, locale)) })} disabled={moving || i === 0}>
                      <ArrowUp size={16} strokeWidth={1.9} aria-hidden="true" />
                    </RowButton>
                    <RowButton action={move} id={l.lineId} extra={{ direction: "down" }} label={t("actions.moveDown", { name: isolate(lineName(l, locale)) })} disabled={moving || i === rows.length - 1}>
                      <ArrowDown size={16} strokeWidth={1.9} aria-hidden="true" />
                    </RowButton>
                    <Link href={`/admin/lines?edit=${encodeURIComponent(l.lineId)}`} className={secondaryButton}>
                      {t("actions.edit")}
                    </Link>
                    <RowButton
                      action={toggle}
                      id={l.lineId}
                      extra={{ active: String(!l.active) }}
                      label={l.active ? t("actions.deactivate") : t("actions.activate")}
                      disabled={toggling}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
