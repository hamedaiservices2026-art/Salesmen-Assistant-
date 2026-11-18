"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { CircleAlert, Plus, RefreshCw, Save, Send } from "lucide-react";
import type { Component, SchemeIssue } from "@/domain/commission";
import type { Unit } from "@/domain/money";
import type { Locale } from "@/i18n/config";
import { ComponentCard } from "@/ui/admin/ComponentCard";
import type { FocusOpt, LineOpt } from "@/ui/admin/ConditionRows";
import { primaryButton, secondaryButton, type FieldState } from "@/ui/admin/form-styles";
import { PreviewPanel, type PreviewView } from "@/ui/admin/PreviewPanel";
import {
  PRESETS,
  fromComponents,
  issueCardIndex,
  issueFieldKey,
  moveCard,
  newCard,
  removeCard,
  toComponents,
  type EditorCard,
  type FormRefs,
  type Preset,
} from "@/ui/admin/scheme-form";
import { previewSchemeAction, publishSchemeAction, saveDraftAction } from "./actions";

export type SchemeEditorProps = {
  ym: string;
  initial: Component[];
  hasDraft: boolean;
  version: number;
  draftRev: number;
  /** Who published the newest version and when (the date already formatted); null when never published. */
  latest: { version: number; byName: string | null; at: string } | null;
  refs: FormRefs;
  lines: LineOpt[];
  focus: FocusOpt[];
  reps: { id: string; name: string }[];
  currencyLabel: string;
  unitLabels: Record<Unit, string>;
};

type Notice = { kind: "saved" | "published" | "invalid"; version?: number };
type Tokens = { version: number; draftRev: number };

const PREVIEW_DELAY_MS = 400;
const snapshot = (cards: EditorCard[]) => JSON.stringify(cards);

function formFor(ym: string, components: Component[] | null, tokens: Tokens, extra: Record<string, string> = {}): FormData {
  const form = new FormData();
  form.set("ym", ym);
  if (components) form.set("components", JSON.stringify(components));
  form.set("expectedVersion", String(tokens.version));
  form.set("expectedDraftRev", String(tokens.draftRev));
  for (const [k, v] of Object.entries(extra)) form.set(k, v);
  return form;
}

export function SchemeEditor(props: SchemeEditorProps) {
  const { ym, refs, lines, focus, reps, currencyLabel, unitLabels } = props;
  const t = useTranslations("admin.schemes");
  const locale = useLocale() as Locale;
  const router = useRouter();

  const [cards, setCards] = useState<EditorCard[]>(() => fromComponents(props.initial, refs));
  const [savedSnap, setSavedSnap] = useState(() => snapshot(fromComponents(props.initial, refs)));
  const [tokens, setTokens] = useState<Tokens>({ version: props.version, draftRev: props.draftRev });
  const [hasDraft, setHasDraft] = useState(props.hasDraft);
  const [repId, setRepId] = useState(reps[0]?.id ?? "");
  const [showErrors, setShowErrors] = useState(false);
  const [issueState, setIssueState] = useState<{ key: string; list: SchemeIssue[] } | null>(null);
  const [stale, setStale] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState<"save" | "publish" | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [preview, setPreview] = useState<{ key: string; view: PreviewView } | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);

  const built = useMemo(() => toComponents(cards), [cards]);
  const complete = Object.keys(built.fieldErrors).length === 0;
  const componentsKey = complete ? JSON.stringify(built.components) : null;
  const dirty = snapshot(cards) !== savedSnap;

  // ---- names for cards, issues and the preview ----
  const presetName = useCallback((p: Preset) => t(`presets.${p}.name`), [t]);
  const cardName = useCallback(
    (c: EditorCard) => (c.label[locale].trim() || c.label.ar.trim() || presetName(c.preset)),
    [locale, presetName],
  );
  const names = useMemo(() => {
    const m: Record<string, string> = {};
    for (const l of lines) m[l.id] = l.name;
    for (const f of focus) m[f.id] = f.name;
    return m;
  }, [lines, focus]);
  const units = useMemo(() => {
    const m: Record<string, Unit> = {};
    for (const l of lines) m[l.id] = l.unit;
    for (const f of focus) m[f.id] = f.unit;
    return m;
  }, [lines, focus]);

  const issues = useMemo(
    () => (issueState && issueState.key === componentsKey ? issueState.list : []),
    [issueState, componentsKey],
  );
  const issueText = useCallback(
    (i: SchemeIssue) => {
      const at = issueCardIndex(i);
      const name = at === null ? null : cards[at] ? cardName(cards[at]) : null;
      const message = t(`errors.${i.code}`);
      return name ? `${name}: ${message}` : message;
    },
    [cards, cardName, t],
  );
  const flagged = useMemo(() => new Set(issues.map((i) => issueFieldKey(cards, i)).filter((k): k is string => k !== null)), [issues, cards]);
  const clientErrorCount = showErrors ? Object.keys(built.fieldErrors).length : 0;
  const problemCount = clientErrorCount + issues.length;

  const stateFor = (card: EditorCard): FieldState => (field) => {
    const key = `${card.id}.${field}`;
    const code = showErrors ? built.fieldErrors[key] : undefined;
    return { invalid: code !== undefined || flagged.has(key), message: code };
  };
  const problemsFor = (index: number) => [...new Set(issues.filter((i) => issueCardIndex(i) === index).map((i) => t(`errors.${i.code}`)))];

  // ---- the preview, 400 ms after the last change ----
  const previewKey = componentsKey !== null && repId !== "" ? `${repId}|${componentsKey}` : null;
  useEffect(() => {
    if (previewKey === null) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const bar = previewKey.indexOf("|");
      const key = componentsKey!;
      const components = JSON.parse(previewKey.slice(bar + 1)) as Component[];
      const form = new FormData();
      form.set("ym", ym);
      form.set("repId", previewKey.slice(0, bar));
      form.set("components", JSON.stringify(components));
      try {
        const r = await previewSchemeAction(form);
        if (cancelled) return;
        if (r.ok) {
          setPreview({ key: previewKey, view: { status: "ok", components, actual: r.actual, projected: r.projected, atFullTarget: r.atFullTarget, nearest: r.nearest } });
          setIssueState((s) => (s && s.key === key ? null : s));
        } else if ("issues" in r) {
          setIssueState({ key, list: r.issues });
          setPreview({ key: previewKey, view: { status: "failed" } });
        } else {
          setPreview({ key: previewKey, view: { status: "failed" } });
        }
      } catch {
        if (!cancelled) setPreview({ key: previewKey, view: { status: "failed" } });
      }
    }, PREVIEW_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // previewKey carries the rep and the components; componentsKey is derived from it.
  }, [previewKey, componentsKey, ym]);

  let view: PreviewView;
  if (reps.length === 0) view = { status: "no_reps" };
  else if (!complete) view = { status: "incomplete" };
  else if (issues.length > 0) view = { status: "issues", messages: issues.map(issueText) };
  else if (preview && preview.key === previewKey) view = preview.view;
  else view = { status: "loading" };

  // ---- leaving with unsaved changes ----
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // A card just added: scroll to it and put the cursor in its first field.
  useEffect(() => {
    if (!focusId) return;
    const el = document.getElementById(`card-${focusId}`);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
    el?.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot: clear the request once handled
    setFocusId(null);
  }, [focusId]);

  const touch = (next: EditorCard[]) => {
    setCards(next);
    setNotice(null);
  };
  const changeCard = (i: number, card: EditorCard) => touch(cards.map((c, k) => (k === i ? card : c)));
  const add = (preset: Preset) => {
    const card = newCard(preset, refs, refs.period);
    touch([...cards, card]);
    setMenuOpen(false);
    setFocusId(card.id);
  };

  // ---- save and publish ----
  const save = async (): Promise<Tokens | null> => {
    setShowErrors(true);
    if (!complete) {
      setNotice({ kind: "invalid" });
      return null;
    }
    const key = componentsKey!;
    const sentCards = cards;
    setBusy("save");
    try {
      const r = await saveDraftAction(formFor(ym, built.components, tokens));
      if (r.ok) {
        const next = { ...tokens, draftRev: r.draftRev };
        setTokens(next);
        setHasDraft(true);
        setSavedSnap(snapshot(sentCards));
        setIssueState(null);
        setNotice({ kind: "saved" });
        return next;
      }
      if ("issues" in r) {
        setIssueState({ key, list: r.issues });
        setNotice({ kind: "invalid" });
      } else {
        setStale(true);
      }
      return null;
    } finally {
      setBusy(null);
    }
  };

  const publish = async () => {
    if (!complete) {
      dialog.current?.close();
      setShowErrors(true);
      setNotice({ kind: "invalid" });
      return;
    }
    const key = componentsKey!;
    setBusy("publish");
    try {
      let current: Tokens | null = tokens;
      // What is typed is what gets published: save it as the draft first when it is not the saved one.
      if (dirty || !hasDraft) {
        const saved = await saveAs(tokens);
        if (!saved) return;
        current = saved;
      }
      const r = await publishSchemeAction(formFor(ym, null, current));
      if (r.ok) {
        setTokens({ version: r.version, draftRev: r.draftRev });
        setHasDraft(false);
        setIssueState(null);
        setNotice({ kind: "published", version: r.version });
        dialog.current?.close();
        router.refresh();
      } else if ("issues" in r) {
        setIssueState({ key, list: r.issues });
        setNotice({ kind: "invalid" });
        dialog.current?.close();
      } else if (r.error === "stale") {
        setStale(true);
        dialog.current?.close();
      } else {
        // no_draft: nothing saved to publish; the next press saves and publishes.
        setHasDraft(false);
        dialog.current?.close();
      }
    } finally {
      setBusy(null);
    }
  };

  // The save inside a publish: same as `save` without touching the busy flag.
  const saveAs = async (from: Tokens): Promise<Tokens | null> => {
    const key = componentsKey!;
    const sentCards = cards;
    const r = await saveDraftAction(formFor(ym, built.components, from));
    if (r.ok) {
      const next = { ...from, draftRev: r.draftRev };
      setTokens(next);
      setHasDraft(true);
      setSavedSnap(snapshot(sentCards));
      return next;
    }
    if ("issues" in r) {
      setIssueState({ key, list: r.issues });
      setNotice({ kind: "invalid" });
    } else {
      setStale(true);
    }
    dialog.current?.close();
    return null;
  };

  // ---- status line ----
  const latest = props.latest;
  const status = hasDraft
    ? tokens.version > 0
      ? t("status.draft", { version: tokens.version })
      : t("status.draftOnly")
    : tokens.version === 0
      ? t("status.none")
      : latest && latest.version === tokens.version
        ? latest.byName
          ? t("status.publishedBy", { version: tokens.version, name: latest.byName, date: latest.at })
          : t("status.publishedAt", { version: tokens.version, date: latest.at })
        : t("status.published", { version: tokens.version });

  const publishDisabled = busy !== null || stale;
  const othersFor = (c: EditorCard) => cards.filter((o) => o.id !== c.id && o.type !== "gate").map((o) => ({ id: o.id, name: cardName(o) }));

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(300px,360px)] items-start gap-5 max-[900px]:grid-cols-1">
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3 rounded-[14px] border border-line bg-white px-5 py-3">
          <p data-testid="scheme-status" className="m-0 text-[14.5px] font-semibold text-ink">
            {status}
          </p>
          {dirty && <span className="rounded-full bg-brand-tint px-3 py-0.5 text-[13px] font-semibold text-brand">{t("status.unsaved")}</span>}
        </div>

        {stale && (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] bg-alert-tint px-5 py-3.5 text-alert">
            <p className="m-0 flex items-center gap-2 text-[14.5px] font-semibold">
              <CircleAlert size={20} strokeWidth={1.8} aria-hidden />
              {t("stale.message")}
            </p>
            <button type="button" onClick={() => window.location.reload()} className={secondaryButton}>
              <RefreshCw size={18} strokeWidth={1.8} aria-hidden />
              {t("stale.reload")}
            </button>
          </div>
        )}

        {problemCount > 0 && (
          <div role="alert" data-testid="scheme-problems" className="flex flex-col gap-1.5 rounded-[14px] bg-alert-tint px-5 py-3.5 text-alert">
            <p className="m-0 flex items-center gap-2 text-[14.5px] font-bold">
              <CircleAlert size={20} strokeWidth={1.8} aria-hidden />
              {t("summary", { count: problemCount })}
            </p>
            <p className="m-0 text-[13.5px]">{t("draftInvalid")}</p>
            {issues.length > 0 && (
              <ul className="m-0 list-none p-0 text-[13.5px]">
                {issues.slice(0, 6).map((i, k) => (
                  <li key={k}>{issueText(i)}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {cards.length === 0 ? (
          <div className="flex flex-col gap-1 rounded-[14px] border border-dashed border-line bg-white px-5 py-8 text-center">
            <h2 className="m-0 text-[16px] font-bold text-ink">{t("empty.title")}</h2>
            <p className="m-0 text-[14px] text-ink-2">{t("empty.body")}</p>
          </div>
        ) : (
          cards.map((card, i) => (
            <ComponentCard
              key={card.id}
              card={card}
              index={i}
              count={cards.length}
              refs={refs}
              lines={lines}
              focus={focus}
              others={othersFor(card)}
              currencyLabel={currencyLabel}
              unitLabels={unitLabels}
              state={stateFor(card)}
              problems={problemsFor(i)}
              onChange={(c) => changeCard(i, c)}
              onMove={(by) => touch(moveCard(cards, i, by))}
              onRemove={() => touch(removeCard(cards, card.id))}
            />
          ))
        )}

        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            aria-expanded={menuOpen}
            aria-controls="preset-menu"
            className={`${secondaryButton} self-start`}
          >
            <Plus size={18} strokeWidth={1.8} aria-hidden />
            {t("add.button")}
          </button>
          {menuOpen && (
            <ul
              id="preset-menu"
              aria-label={t("add.menuLabel")}
              onKeyDown={(e) => e.key === "Escape" && setMenuOpen(false)}
              className="m-0 grid list-none grid-cols-2 gap-2.5 rounded-[14px] border border-line bg-white p-3 max-[1250px]:grid-cols-1"
            >
              {PRESETS.map((p) => (
                <li key={p}>
                  <button
                    type="button"
                    onClick={() => add(p)}
                    className="flex min-h-11 w-full flex-col items-start gap-0.5 rounded-xl border border-line bg-white px-4 py-2.5 text-start hover:bg-brand-tint focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                  >
                    <span className="text-[14.5px] font-bold text-ink">{t(`presets.${p}.name`)}</span>
                    <span className="text-[13px] text-ink-2">{t(`presets.${p}.hint`)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center gap-3 rounded-[14px] border border-line bg-white px-5 py-3 shadow-[0_-4px_14px_rgba(14,27,46,0.06)]">
          <button type="button" onClick={() => void save()} disabled={busy !== null || stale} className={secondaryButton}>
            <Save size={18} strokeWidth={1.8} aria-hidden />
            {busy === "save" ? t("save.saving") : t("save.draft")}
          </button>
          <button type="button" onClick={() => dialog.current?.showModal()} disabled={publishDisabled} className={primaryButton}>
            <Send size={18} strokeWidth={1.8} aria-hidden />
            {t("publish.button")}
          </button>
          {notice && (
            <p role="status" className={`m-0 text-[14px] ${notice.kind === "invalid" ? "font-semibold text-alert" : "text-ink-2"}`}>
              {notice.kind === "saved" && t("save.saved")}
              {notice.kind === "published" && t("publish.done", { version: notice.version ?? 0 })}
              {notice.kind === "invalid" && t("draftInvalid")}
            </p>
          )}
        </div>
      </div>

      <div className="sticky top-4 max-[900px]:static">
        <PreviewPanel
          reps={reps}
          repId={repId}
          onRepChange={setRepId}
          view={view}
          names={names}
          units={units}
          currencyLabel={currencyLabel}
          unitLabels={unitLabels}
        />
      </div>

      <dialog
        ref={dialog}
        aria-labelledby="publish-title"
        className="m-auto w-[min(460px,calc(100vw-32px))] rounded-[14px] border border-line bg-white p-6 text-ink backdrop:bg-black/40"
      >
        <h2 id="publish-title" className="m-0 mb-2 text-[18px] font-bold">
          {t("confirm.title")}
        </h2>
        <p className="m-0 text-[15px]">{t("confirm.body")}</p>
        {cards.length === 0 && (
          <p role="alert" className="m-0 mt-3 rounded-lg bg-alert-tint px-3 py-2.5 text-[14px] font-semibold text-alert">
            {t("confirm.empty")}
          </p>
        )}
        {(dirty || !hasDraft) && <p className="m-0 mt-3 text-[13.5px] text-ink-2">{t("confirm.saveFirst")}</p>}
        <div className="mt-5 flex flex-wrap justify-end gap-3">
          <button type="button" onClick={() => dialog.current?.close()} disabled={busy === "publish"} className={secondaryButton}>
            {t("confirm.cancel")}
          </button>
          <button type="button" onClick={() => void publish()} disabled={busy === "publish"} className={primaryButton}>
            {busy === "publish" ? t("publish.publishing") : t("confirm.confirm")}
          </button>
        </div>
      </dialog>
    </div>
  );
}
