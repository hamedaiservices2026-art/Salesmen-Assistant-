"use client";

import { useActionState, useDeferredValue, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { LOCALES, LOCALE_ENDONYM, type Locale } from "@/i18n/config";
import { POLICY_BODY_MAX, POLICY_TITLE_MAX, checkPolicyFile, codePointLength, decodePolicyBytes, splitSections } from "@/domain/policy";
import { fieldBad, fieldInput, fieldLabel, fieldOk, primaryButton, secondaryButton } from "@/ui/admin/form-styles";
import { savePolicyAction, type PolicyFormState } from "./actions";

export type PolicyItem = { id: string; version: number; title: string; locale: Locale; body: string };

const PREVIEW_ROWS = 100;
const SNIPPET = 80;
const num = new Intl.NumberFormat("en-US");

export function PolicyEditor({ item, justSaved, defaultLocale }: { item: PolicyItem | null; justSaved: boolean; defaultLocale: Locale }) {
  const t = useTranslations("admin.policies");
  const [state, action, pending] = useActionState<PolicyFormState, FormData>(savePolicyAction, {});
  const v = state.values ?? {};
  const [body, setBody] = useState(v.body ?? item?.body ?? "");
  const [fileError, setFileError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const deferred = useDeferredValue(body);
  const sections = useMemo(() => splitSections(deferred), [deferred]);
  const length = codePointLength(body);

  const err = (field: string) => (state.errors?.[field] ? t(`errors.${state.errors[field]}`) : undefined);
  const cls = (field: string) => `${fieldInput} ${err(field) ? fieldBad : fieldOk}`;
  const aria = (field: string) => ({
    "aria-invalid": err(field) ? (true as const) : undefined,
    "aria-describedby": err(field) ? `${field}-error` : undefined,
  });
  const error = (field: string) =>
    err(field) && (
      <span id={`${field}-error`} role="alert" className="mt-1 block text-[13px] text-alert">
        {err(field)}
      </span>
    );

  async function onFile(file: File | undefined) {
    setFileError(null);
    if (!file) return;
    // Name, type and size are checked before a byte is read.
    const bad = checkPolicyFile(file);
    if (bad) return reject(bad);
    try {
      const decoded = decodePolicyBytes(await file.arrayBuffer());
      if (!decoded.ok) return reject(decoded.error);
      setBody(decoded.text);
    } catch {
      reject("read_failed");
    }
  }
  function reject(code: string) {
    setFileError(code);
    if (fileInput.current) fileInput.current.value = "";
  }

  return (
    <form action={action} className="flex flex-col gap-4 px-5 pb-5">
      {justSaved && !state.errors && (
        <p role="status" className="m-0 rounded-lg bg-brand-tint px-4 py-3 text-[14.5px] text-brand">
          {t("saved")}
        </p>
      )}
      {state.errors?.form && (
        <p role="alert" className="m-0 rounded-lg bg-alert-tint px-4 py-3 text-[14.5px] text-alert">
          {t(`errors.${state.errors.form}`)}{" "}
          {item && state.errors.form === "stale" && (
            <Link href={`/admin/policies?edit=${encodeURIComponent(item.id)}`} className="font-semibold underline">
              {t("reload")}
            </Link>
          )}
        </p>
      )}
      {item && <input type="hidden" name="id" value={item.id} />}
      {item && <input type="hidden" name="version" value={item.version} />}
      <div className="grid grid-cols-[2fr_1fr] items-start gap-4 max-[900px]:grid-cols-1">
        <label className="block">
          <span className={fieldLabel}>{t("fields.title")}</span>
          <input name="title" required maxLength={POLICY_TITLE_MAX} defaultValue={v.title ?? item?.title ?? ""} className={cls("title")} {...aria("title")} />
          {error("title")}
        </label>
        <label className="block">
          <span className={fieldLabel}>{t("fields.locale")}</span>
          <select name="locale" defaultValue={v.locale ?? item?.locale ?? defaultLocale} className={cls("locale")} {...aria("locale")}>
            {LOCALES.map((l) => (
              <option key={l} value={l}>
                {LOCALE_ENDONYM[l]}
              </option>
            ))}
          </select>
          {error("locale")}
        </label>
      </div>
      <div>
        <label className="block">
          <span className={fieldLabel}>{t("file.label")}</span>
          <input
            ref={fileInput}
            type="file"
            accept=".txt,.md,text/plain,text/markdown"
            onChange={(e) => void onFile(e.currentTarget.files?.[0])}
            className={`${fieldInput} ${fieldOk} py-2`}
            aria-describedby="file-hint"
          />
        </label>
        <p id="file-hint" className="m-0 mt-1 text-[13px] text-ink-2">
          {t("file.hint")}
        </p>
        {fileError && (
          <p role="alert" className="m-0 mt-1 text-[13px] text-alert">
            {t(`file.errors.${fileError}`)}
          </p>
        )}
      </div>
      <label className="block">
        <span className={fieldLabel}>{t("fields.body")}</span>
        <textarea
          name="body"
          required
          rows={14}
          value={body}
          onChange={(e) => setBody(e.currentTarget.value)}
          className={`${cls("body")} min-h-48 py-2 leading-relaxed`}
          dir="auto"
          {...aria("body")}
        />
        {error("body")}
        <span className={`mt-1 block text-[13px] tabular-nums ${length > POLICY_BODY_MAX ? "text-alert" : "text-ink-2"}`}>
          {t("counter", { count: num.format(length), max: num.format(POLICY_BODY_MAX) })}
        </span>
      </label>

      <section aria-labelledby="sections-title" className="rounded-lg border border-line">
        <h3 id="sections-title" className="m-0 border-b border-line bg-canvas px-4 py-2.5 text-[14px] font-bold text-ink">
          {t("sections.title", { count: num.format(sections.length) })}
        </h3>
        {sections.length === 0 ? (
          <p className="m-0 px-4 py-3 text-[14px] text-ink-2">{t("sections.empty")}</p>
        ) : (
          <ol className="m-0 flex list-none flex-col p-0" data-testid="sections">
            {sections.slice(0, PREVIEW_ROWS).map((sec, i) => {
              const chars = codePointLength(sec.text);
              const snippet = Array.from(sec.text.replace(/\s+/g, " ").slice(0, SNIPPET * 2)).slice(0, SNIPPET).join("");
              return (
                <li key={i} className="flex flex-col gap-0.5 border-b border-line-soft px-4 py-2.5 last:border-b-0">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <bdi className="text-[14.5px] font-semibold text-ink">{sec.label === "" ? t("sections.preamble") : sec.label}</bdi>
                    <span className="text-[13px] tabular-nums text-ink-2">{t("sections.chars", { count: num.format(chars) })}</span>
                  </div>
                  <bdi className="text-[13.5px] text-ink-2">
                    {snippet}
                    {chars > SNIPPET ? "…" : ""}
                  </bdi>
                </li>
              );
            })}
          </ol>
        )}
        {sections.length > PREVIEW_ROWS && (
          <p className="m-0 border-t border-line-soft px-4 py-2.5 text-[13px] text-ink-2">{t("sections.more", { count: num.format(sections.length - PREVIEW_ROWS) })}</p>
        )}
      </section>

      <div className="flex flex-wrap justify-end gap-3">
        {item && (
          <Link href="/admin/policies" className={secondaryButton}>
            {t("cancel")}
          </Link>
        )}
        <button type="submit" disabled={pending} className={primaryButton}>
          {pending ? t("saving") : item ? t("save") : t("saveNew")}
        </button>
      </div>
    </form>
  );
}
