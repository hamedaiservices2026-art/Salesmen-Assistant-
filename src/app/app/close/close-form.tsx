"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import type { CloseDraft } from "@/domain/ai/draft";
import { fillForm } from "@/domain/ai/apply-draft";
import { fieldReview, reviewState } from "@/domain/ai/review";
import type { LineKind } from "@/domain/lines";
import { AmountField } from "@/ui/components/AmountField";
import { DraftBanner } from "@/ui/components/DraftBanner";
import { PrimaryButton } from "@/ui/components/PrimaryButton";
import { ReconciliationPanel } from "@/ui/components/ReconciliationPanel";
import { ReturnsEditor, type ReturnRow } from "@/ui/components/ReturnsEditor";
import { parseAmount, type Unit } from "@/domain/money";
import { saveCloseAction, type CloseState } from "./actions";
import { CloseMethods, type AiStatus, type DraftRead } from "./close-methods";
import { clearDraft, loadDraft, saveDraft } from "./draft-store";

export type FormItem = {
  name: string;
  label: string;
  unitLabel: string;
  mode: "decimal" | "numeric";
  collection?: boolean;
  /** The line was created after this day, so it may be left empty. */
  optional?: boolean;
  /** What the admin's upload recorded for this line, shown under the field. */
  notes?: string[];
  /** The admin's stored amount (minor units) for a line an upload set; it, not the typed value, counts. */
  adminAmount?: number;
  /** A daily line: what a draft is matched against (the code) and read in (the unit). */
  line?: { lineId: string; code: string; unit: Unit; kind: LineKind };
};

/** A draft being reviewed: what it filled and what is still to look at. */
type Review = {
  draft: CloseDraft;
  draftId: string;
  transcript?: string;
  marks: Record<string, "ai" | "low">;
  /** The text the draft put in each field. */
  filled: Record<string, string>;
  skippedAdmin: Record<string, string>;
  missing: string[];
};

const STOCK = ["loaded", "sold", "returned"];

function sessionStore(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

const card = "rounded-[14px] border border-line bg-white px-4 py-1";
const heading = "m-0 px-1 text-[15px] font-bold";

/** The day close: typed, or filled from a photo or voice note and then reviewed. Everything the rep types lives in state, so an error never clears it. */
export function CloseForm({
  date,
  lineItems,
  focusItems,
  initial,
  initialReturns,
  currencyLabel,
  stockUnitLabel,
  vision,
  stt,
  noticeVersion,
  userKey,
  contextKey,
  pastSellingDays,
}: {
  date: string;
  lineItems: FormItem[];
  focusItems: FormItem[];
  initial: Record<string, string>;
  initialReturns: ReturnRow[];
  currencyLabel: string;
  stockUnitLabel: string;
  vision: AiStatus;
  stt: AiStatus;
  noticeVersion: number;
  /** A hash of the signed-in user, so two reps on one phone never share a stored draft. */
  userKey: string;
  /** `draftContextKey(lines, date)`: a stored draft read against other lines is dropped. */
  contextKey: string;
  /** Past selling days a report's date may point to ("open that day's close"). */
  pastSellingDays: string[];
}) {
  const t = useTranslations("close");
  const [state, action, pending] = useActionState<CloseState, FormData>(saveCloseAction, { errors: {} });
  const [values, setValues] = useState(initial);
  const [rows, setRows] = useState(initialReturns);
  // Photos still uploading, per return row: the close waits for them (a confirm now would drop them; R71).
  const [busy, setBusy] = useState<Record<number, number>>({});
  const uploading = Object.values(busy).some((n) => n > 0);

  const [review, setReview] = useState<Review | null>(null);
  const [acked, setAcked] = useState<ReadonlySet<string>>(new Set());
  const [stockForced, setStockForced] = useState(false);
  // Fields the rep typed in since the page loaded: a draft never fills them.
  const touched = useRef(new Set<string>());
  const latest = useRef({ values, review, initial });
  const formEl = useRef<HTMLFormElement>(null);
  const focusNext = useRef(false);
  const submitted = useRef(false);
  const failedSave = useRef(false);
  useEffect(() => {
    latest.current = { values, review, initial };
  });

  useEffect(() => {
    if (Object.keys(state.errors).length > 0) {
      failedSave.current = true;
      document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
    }
  }, [state]);

  const lines = lineItems.flatMap((it) => (it.line ? [{ ...it.line, field: it.name, optional: it.optional === true, adminAmount: it.adminAmount }] : []));

  /** Puts a draft into the form: only fields the rep has not touched are filled, and the rest of the form stays as it is. */
  function apply(read: DraftRead, opts: { save: boolean }) {
    const { values: current, review: before } = latest.current;
    const fill = fillForm(read.draft, { lines, current, touched: touched.current });
    setValues((v) => ({ ...v, ...fill.values }));
    setReview({
      draft: read.draft,
      draftId: read.draftId,
      ...(read.transcript ? { transcript: read.transcript } : {}),
      marks: { ...(before?.marks ?? {}), ...fill.marks },
      filled: { ...(before?.filled ?? {}), ...fill.values },
      skippedAdmin: fill.skippedAdmin,
      missing: fill.missing,
    });
    setAcked((a) => new Set([...a].filter((n) => !Object.hasOwn(fill.marks, n))));
    if (STOCK.some((n) => Object.hasOwn(fill.values, n))) setStockForced(true);
    failedSave.current = false;
    if (opts.save) {
      const storage = sessionStore();
      if (storage) saveDraft(storage, userKey, { draft: read.draft, draftId: read.draftId, savedAt: Date.now(), contextKey, ...(read.transcript ? { transcript: read.transcript } : {}) });
    }
  }

  // A reload keeps the review: read the stored draft back (validated, same day, same lines, not expired).
  useEffect(() => {
    const storage = sessionStore();
    const stored = storage ? loadDraft(storage, userKey, date, Date.now(), contextKey) : null;
    // sessionStorage exists only in the browser, so the stored draft is read after mount.
    if (stored) apply(stored, { save: false });
    // Once, on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A confirmed close clears the stored draft: the page is left (redirect) after a submit that returned no errors.
  useEffect(
    () => () => {
      if (submitted.current && !failedSave.current) {
        const storage = sessionStore();
        if (storage) clearDraft(storage, userKey, date);
      }
    },
    [userKey, date],
  );

  /** Throws the reading away: fields still as the draft read them go back to what they held before. */
  function clearReading() {
    const r = latest.current.review;
    if (r) {
      setValues((v) => {
        const next = { ...v };
        for (const name of Object.keys(r.filled)) if (next[name] === r.filled[name]) next[name] = latest.current.initial[name] ?? "";
        return next;
      });
    }
    setReview(null);
    setAcked(new Set());
    const storage = sessionStore();
    if (storage) clearDraft(storage, userKey, date);
  }

  const err = (name: string) => {
    const code = state.errors[name];
    if (!code) return undefined;
    // Photo problems have their own copy (a return's photos field, or one photo by id).
    return name.startsWith("photo.") || name.endsWith(".photos") ? t(`photo.errors.${code}` as never) : t(`errors.${code}` as never);
  };
  const errorMap: Record<string, string | undefined> = Object.fromEntries(
    Object.keys(state.errors).map((k) => [k, err(k)]),
  );

  const money = (name: string): FormItem => ({ name, label: t(name), unitLabel: currencyLabel, mode: "decimal" });
  const stock = (name: string): FormItem => ({ name, label: t(name), unitLabel: stockUnitLabel, mode: "numeric" });
  const v = (name: string) => values[name] ?? "";
  const collectionItems = lineItems.filter((it) => it.collection);
  // A collection target line is the collections figure; only without one is it asked separately.
  const collections =
    collectionItems.length > 0
      ? collectionItems.reduce((sum, it) => sum + (it.adminAmount ?? parseAmount(v(it.name), "value") ?? 0), 0)
      : (parseAmount(v("collections"), "value") ?? 0);
  const salesItems = lineItems.filter((it) => !it.collection);
  // Collection lines sit among the money fields (cash, credit, collected, expenses), not under "sell today".
  const moneyItems: FormItem[] =
    collectionItems.length > 0
      ? [money("cashSales"), money("creditSales"), ...collectionItems, money("expenses")]
      : ["cashSales", "creditSales", "collections", "expenses"].map(money);
  const stockOpen = STOCK.some((n) => (initial[n] ?? "") !== "" || state.errors[n] !== undefined) || stockForced;

  // What the rep still has to check, in the order the fields appear on screen.
  const order = [...salesItems, ...moneyItems, ...focusItems, ...STOCK.map(stock)].map((it) => it.name);
  const marks = review?.marks ?? {};
  const reviewInput = { marks, filled: review?.filled ?? {}, current: values, acknowledged: acked, order };
  const { pending: toCheck, canConfirm } = reviewState(reviewInput);

  function acknowledge(name: string) {
    focusNext.current = true;
    setAcked((a) => new Set(a).add(name));
  }
  useEffect(() => {
    if (!focusNext.current) return;
    focusNext.current = false;
    // The button that was pressed is gone: go to the next field to check, or to the confirm button.
    const next = formEl.current?.querySelector<HTMLElement>('[data-ack="pending"]') ?? formEl.current?.querySelector<HTMLElement>('button[type="submit"]:not(:disabled)');
    next?.focus();
  }, [acked]);

  const field = (it: FormItem, unitLabel: string | undefined = it.unitLabel) => {
    const shown = fieldReview(it.name, reviewInput);
    const sourceNote = review?.draft.source === "voice" ? t("draft.fromVoice") : t("draft.fromPhoto");
    const read = review?.skippedAdmin[it.name];
    const label = it.optional ? t("optionalLabel", { label: it.label }) : it.label;
    const notes = [...(it.notes ?? []), ...(read !== undefined ? [t(review?.draft.source === "voice" ? "draft.voiceRead" : "draft.photoRead", { amount: `${read} ${it.unitLabel}` })] : [])];
    return (
      <AmountField
        key={it.name}
        name={it.name}
        label={label}
        unitLabel={unitLabel}
        mode={it.mode}
        value={values[it.name] ?? ""}
        onChange={(val) => {
          touched.current.add(it.name);
          setValues((s) => ({ ...s, [it.name]: val }));
        }}
        error={err(it.name)}
        notes={notes.length > 0 ? notes : undefined}
        mark={shown ?? undefined}
        markNote={shown === "low" ? t("draft.check") : shown === "ai" ? sourceNote : undefined}
        ackLabel={t("draft.ok")}
        ackAria={t("draft.okFor", { label: it.label })}
        onAcknowledge={() => acknowledge(it.name)}
        missingNote={review?.missing.includes(it.name) && (values[it.name] ?? "").trim() === "" ? t("draft.notRead") : undefined}
      />
    );
  };

  const reportDate = review?.draft.reportDate ?? null;

  return (
    <>
      <CloseMethods date={date} vision={vision} stt={stt} noticeVersion={noticeVersion} onRead={(read) => apply(read, { save: true })} />
      <main className="flex flex-1 flex-col gap-3 px-5 pb-4 pt-3">
        {review && (
          <DraftBanner
            source={review.draft.source}
            transcript={review.transcript}
            problems={review.draft.problems.length}
            reportDate={reportDate}
            dateMismatch={review.draft.dateMismatch}
            openDayHref={reportDate && pastSellingDays.includes(reportDate) ? `/app/close?date=${reportDate}` : null}
            onClear={clearReading}
          />
        )}
        <form
          ref={formEl}
          action={action}
          noValidate
          onSubmit={(e) => {
            // Doubtful fields must be checked first; the server checks everything again either way.
            if (uploading || !canConfirm) {
              e.preventDefault();
              return;
            }
            submitted.current = true;
            failedSave.current = false;
          }}
          className="flex flex-col gap-3"
        >
          <input type="hidden" name="date" value={date} />
          {review && <input type="hidden" name="draftId" value={review.draftId} />}

          {Object.keys(state.errors).length > 0 && (
            <p role="alert" className="m-0 flex items-center gap-2 rounded-xl bg-alert-tint px-3.5 py-2.5 text-[13.5px] font-bold text-alert">
              <TriangleAlert aria-hidden="true" size={18} strokeWidth={2.2} className="shrink-0" />
              {err("date") ?? t("fixErrors")}
            </p>
          )}

          {salesItems.length > 0 && (
            <section aria-labelledby="h-lines" className="flex flex-col gap-1.5">
              <h2 id="h-lines" className={heading}>
                {t("linesTitle")}
              </h2>
              <div className={card}>{salesItems.map((it) => field(it))}</div>
            </section>
          )}

          <section aria-labelledby="h-money" className="flex flex-col gap-1.5">
            <h2 id="h-money" className={heading}>
              {t("moneyTitle")}
            </h2>
            <div className={card}>{moneyItems.map((it) => field(it))}</div>
          </section>

          {focusItems.length > 0 && (
            <section aria-labelledby="h-focus" className="flex flex-col gap-1.5">
              <h2 id="h-focus" className={heading}>
                {t("focusTitle")}
              </h2>
              <div className={card}>{focusItems.map((it) => field(it))}</div>
            </section>
          )}

          <details open={stockOpen || undefined} className="rounded-[14px] border border-line bg-white px-4">
            <summary className="flex min-h-12 cursor-pointer items-center text-[15px] font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
              {t("stockSummary")}
            </summary>
            {STOCK.map((n) => field(stock(n)))}
          </details>

          <ReturnsEditor
            date={date}
            rows={rows}
            onChange={setRows}
            onBusy={(key, n) => setBusy((b) => (b[key] === n ? b : { ...b, [key]: n }))}
            errors={errorMap}
          />

          <ReconciliationPanel
            cashSales={v("cashSales")}
            collections={collections}
            expenses={v("expenses")}
            loaded={v("loaded")}
            sold={v("sold")}
            returned={v("returned")}
            currencyLabel={currencyLabel}
            stockUnitLabel={stockUnitLabel}
            collectionsNote={collectionItems.some((it) => it.adminAmount !== undefined) ? t("collectionsByAdmin") : undefined}
          />

          {toCheck.length > 0 && (
            <p id="needs-review" role="status" className="m-0 flex items-center gap-2 rounded-xl bg-alert-tint px-3.5 py-2.5 text-[13.5px] font-bold text-alert">
              <TriangleAlert aria-hidden="true" size={18} strokeWidth={2.2} className="shrink-0" />
              {t("draft.needsReview")}
            </p>
          )}
          <PrimaryButton disabled={pending || uploading || !canConfirm}>
            {pending ? t("submitting") : uploading ? t("photo.uploading") : t("submit")}
          </PrimaryButton>
        </form>
      </main>
    </>
  );
}
