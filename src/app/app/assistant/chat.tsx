"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import { BookOpen, CircleSlash, LoaderCircle, Mic, SendHorizontal, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { AiNoticeSheet } from "@/ui/components/AiNotice";
import { AssistantUnavailable } from "@/ui/components/AssistantUnavailable";
import { IncentiveCard } from "@/ui/components/IncentiveCard";
import { NoVoiceHint, ReadAloud, ReadAloudProvider } from "@/ui/components/ReadAloud";
import { VoiceRecorder } from "@/ui/components/VoiceRecorder";
import { readErrorKey, transcribeAudio } from "@/ui/ai-client";
import {
  chatReducer,
  counterText,
  counterVisible,
  initialChat,
  QUESTION_MAX,
  submitCheck,
  type BlockReason,
  type ChatItem,
  type ChatReply,
  type StoredMessage,
} from "@/ui/chat-state";
import { askAction } from "./actions";
import { ClearConversation } from "./clear-conversation";

export type AiStatus = { available: boolean; reason: string | null };
export type IncentiveView = { id: string; title: string; body: string; when: string };

/** Notification ids already explained in this page load, for a browser that keeps no session storage. */
const explainedInMemory = new Set<string>();
/** Explain requests in flight, so a double effect run cannot send one twice. */
const explainBusy = new Set<string>();

function chipClass(): string {
  return "inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-2xl border border-line bg-white px-2.5 py-1 text-[12.5px] font-medium text-ink-2 break-words";
}

function Bubble({ item }: { item: ChatItem }) {
  const t = useTranslations("assistant");
  // Nastaliq needs more line height than the other scripts.
  const lead = useLocale() === "ur" ? "leading-[2.2]" : "leading-relaxed";
  if (item.kind === "user") {
    return (
      <div className="min-w-0 max-w-[82%] self-end rounded-2xl rounded-be-[4px] bg-brand px-3.5 py-2.5 text-[14.5px] text-white">
        <span className="sr-only">{t("who.user")}: </span>
        <p dir="auto" className={`m-0 whitespace-pre-line break-words ${lead}`}>
          {item.text}
        </p>
      </div>
    );
  }
  return (
    <div className="flex min-w-0 max-w-[92%] flex-col gap-2.5 self-start rounded-2xl rounded-bs-[4px] border border-line bg-white p-3.5 text-[14.5px]">
      <span className="sr-only">{t("who.assistant")}: </span>
      {item.kind === "answer" ? (
        <>
          {/* The answer is text: nothing in it is a link or markup. */}
          <p dir="auto" className={`m-0 whitespace-pre-line break-words ${lead}`}>
            {item.text}
          </p>
          {item.citations.length > 0 && (
            <ul aria-label={t("sourcesLabel")} className="m-0 flex min-w-0 list-none flex-wrap gap-1.5 p-0">
              {item.citations.map((c, i) => (
                <li key={`${c.title}-${c.label}-${i}`} className={chipClass()}>
                  <BookOpen aria-hidden="true" size={14} strokeWidth={2} className="shrink-0" />
                  <span dir="auto">
                    {c.title} · {c.label}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <ReadAloud text={item.text} className="self-start" />
        </>
      ) : (
        <>
          <p className={`m-0 flex items-start gap-2 font-semibold text-ink ${lead}`}>
            <CircleSlash aria-hidden="true" size={20} strokeWidth={2} className="mt-0.5 shrink-0 text-alert" />
            <span>
              {item.verdict === "not_in_documents"
                ? t("verdict.notInDocuments")
                : item.verdict === "no_answer"
                  ? t("verdict.noAnswer")
                  : item.facts === null || item.facts.length === 0
                    ? t("verdict.unverifiedOld")
                    : t("verdict.unverified")}
            </span>
          </p>
          {/* Only the figures the server chose; nothing the model wrote reaches a verdict card. */}
          {item.facts !== null && item.facts.length > 0 && (
            <dl className="m-0 flex flex-col gap-1.5 rounded-xl bg-brand-tint px-3 py-2.5">
              {item.facts.map((f) => (
                <div key={f.id} className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <dt dir="auto" className="text-[13.5px] text-ink-2">
                    {f.label}
                  </dt>
                  <dd className="m-0 text-[14.5px] font-bold tabular-nums">
                    <bdi>{f.value}</bdi>
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </>
      )}
    </div>
  );
}

/**
 * The assistant screen: recent incentive notices, the conversation, suggested questions and the
 * input row. All state transitions are in `chatReducer`. A question is sent once (the button is
 * disabled while one is pending and a second submit is ignored); a voice transcript only fills the
 * field, the rep sends it himself.
 */
export function Chat({
  stored,
  incentives,
  hasPolicy,
  chat,
  stt,
  noticeVersion,
  explainId,
}: {
  stored: StoredMessage[];
  incentives: IncentiveView[];
  hasPolicy: boolean;
  chat: AiStatus;
  stt: AiStatus;
  noticeVersion: number;
  explainId: string | null;
}) {
  const t = useTranslations("assistant");
  const tRoot = useTranslations();
  const [state, dispatch] = useReducer(chatReducer, undefined, () => initialChat(stored));
  const blocked: BlockReason | null = state.blocked ?? (chat.available ? null : ((chat.reason ?? "disabled") as BlockReason));
  const pendingRef = useRef(false);
  const field = useRef<HTMLInputElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const shown = useRef(state.items.length);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [hearing, setHearing] = useState(false);
  const [voiceMessage, setVoiceMessage] = useState<string | null>(null);
  const [voiceUnavailable, setVoiceUnavailable] = useState<string | null>(null);
  const [noticeOpen, setNoticeOpen] = useState(false);
  const transcribing = useRef<AbortController | null>(null);

  const overlayOpen = voiceOpen || noticeOpen;
  const focusField = () => {
    if (!overlayOpen) field.current?.focus();
  };

  /** Sends `raw` once; resolves with the reply, or null when nothing was sent. */
  function submit(raw: string, explain?: string): Promise<ChatReply | null> {
    if (pendingRef.current) return Promise.resolve(null);
    const c = submitCheck({ pending: false, blocked }, raw);
    if (!c.ok) {
      if (c.reason === "empty" || c.reason === "too_long") dispatch({ type: "send", question: raw });
      return Promise.resolve(null);
    }
    pendingRef.current = true;
    dispatch({ type: "send", question: c.question });
    focusField();
    return askAction(c.question, explain)
      .catch((): ChatReply => ({ ok: false, reason: "failed" }))
      .then((result) => {
        pendingRef.current = false;
        dispatch({ type: "result", result });
        return result;
      });
  }

  // After a result (an answer or a refusal) the rep types the next question: focus returns to the field.
  const wasPending = useRef(false);
  useEffect(() => {
    if (wasPending.current && !state.pending) field.current?.focus();
    wasPending.current = state.pending;
  }, [state.pending]);
  // A field error moves focus to the field it is about.
  useEffect(() => {
    if (state.fieldError) field.current?.focus();
  }, [state.fieldError]);

  // `?explain=<notificationId>`: one request on load. The guard is per tab (session storage) and is
  // written only after an answer, so a reload, a back button or a double effect run of development
  // mode cannot send it twice, and a failed first attempt is not lost.
  const submitRef = useRef(submit);
  useEffect(() => {
    submitRef.current = submit;
  });
  const explainQuestion = t("explainQuestion");
  useEffect(() => {
    if (!explainId) return;
    window.history.replaceState(null, "", window.location.pathname);
    if (blocked !== null) return;
    const key = `assistant.explain.${explainId}`;
    let done = false;
    try {
      done = window.sessionStorage.getItem(key) !== null;
    } catch {
      done = explainedInMemory.has(explainId);
    }
    if (done || explainBusy.has(explainId)) return;
    explainBusy.add(explainId);
    void submitRef.current(explainQuestion, explainId).then((r) => {
      explainBusy.delete(explainId);
      if (r?.ok !== true) return;
      try {
        window.sessionStorage.setItem(key, "1");
      } catch {
        explainedInMemory.add(explainId);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per id on load
  }, [explainId]);

  // The newest card comes into view (not on the first paint of a stored conversation).
  useEffect(() => {
    if (state.items.length > shown.current || (state.pending && state.items.length > 0)) end.current?.scrollIntoView({ block: "end" });
    shown.current = state.items.length;
  }, [state.items.length, state.pending]);

  useEffect(() => () => transcribing.current?.abort(), []);

  async function onRecorded(blob: Blob) {
    setVoiceOpen(false);
    setVoiceMessage(null);
    transcribing.current?.abort();
    const ctl = new AbortController();
    transcribing.current = ctl;
    setHearing(true);
    const r = await transcribeAudio(blob, { signal: ctl.signal });
    if (transcribing.current !== ctl) return;
    transcribing.current = null;
    setHearing(false);
    if (r.ok) {
      dispatch({ type: "transcript", text: r.transcript });
      field.current?.focus();
    } else if (r.reason === "no_notice") setNoticeOpen(true);
    else if (r.reason !== "cancelled") setVoiceMessage(readErrorKey("transcribe", r.reason));
  }

  function onMic() {
    setVoiceMessage(null);
    if (voiceOpen) {
      setVoiceOpen(false);
      return;
    }
    if (!stt.available) {
      if (stt.reason === "no_notice") setNoticeOpen(true);
      else setVoiceUnavailable(stt.reason ?? "failed");
      return;
    }
    setVoiceUnavailable(null);
    setVoiceOpen(true);
  }

  const suggestions = [
    t("suggest.standing"),
    t("suggest.commission"),
    t("suggest.incentives"),
    ...(hasPolicy ? [t("suggest.policy")] : []),
  ];
  const last = state.items.at(-1);
  const showSuggestions = !state.pending && blocked === null && (last === undefined || last.kind !== "user");
  const sendDisabled = state.pending || blocked !== null;
  const errorKey = state.fieldError ? readErrorKey("ask", state.fieldError) : null;

  return (
    <ReadAloudProvider>
      <main className="flex flex-1 flex-col gap-3 px-5 pb-3 pt-4">
        {incentives.map((n) => (
          <IncentiveCard key={n.id} title={n.title} body={n.body} when={n.when} explainDisabled={state.pending || blocked !== null} onExplain={() => void submit(explainQuestion, n.id)} />
        ))}

        <NoVoiceHint />

        <div role="log" aria-label={t("conversationLabel")} className="flex flex-col gap-3">
          {state.items.map((item) => (
            <Bubble key={item.id} item={item} />
          ))}
        </div>

        <div role="status" className="self-start">
          {state.pending && (
            <p className="m-0 flex items-center gap-2.5 rounded-xl border border-line bg-white px-4 py-3 text-[14px] font-medium text-ink">
              <LoaderCircle aria-hidden="true" size={20} strokeWidth={2} className="shrink-0 animate-spin text-brand" />
              {t("thinking")}
            </p>
          )}
        </div>

        {state.notice !== null && state.notice !== blocked && <AssistantUnavailable reason={state.notice} />}

        {blocked !== null && (
          <div className="flex flex-col gap-2">
            <AssistantUnavailable reason={blocked} />
            {blocked === "no_notice" && (
              <button
                type="button"
                onClick={() => setNoticeOpen(true)}
                className="min-h-11 self-start rounded-xl border border-brand bg-white px-4 text-[14px] font-bold text-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
              >
                {tRoot("settings.ai.read")}
              </button>
            )}
          </div>
        )}

        {showSuggestions && (
          <div role="group" aria-label={t("suggest.label")} className="mt-auto flex flex-wrap gap-2 pt-2">
            {suggestions.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => void submit(q)}
                className="min-h-11 rounded-full border border-line bg-white px-3.5 text-[13.5px] font-medium text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
              >
                {q}
              </button>
            ))}
          </div>
        )}

        {state.items.length > 0 && (
          <div className="pt-1">
            <ClearConversation label={t("clear")} onCleared={() => dispatch({ type: "clear" })} />
          </div>
        )}
        <div ref={end} />
      </main>

      <div className="sticky bottom-[68px] z-10 flex flex-col gap-2 border-t border-line bg-white px-4 py-2.5">
        {voiceUnavailable && <AssistantUnavailable kind="transcribe" reason={voiceUnavailable} />}
        {voiceOpen && <VoiceRecorder hint={t("hint")} onRecorded={(blob) => void onRecorded(blob)} />}
        <div role="status">
          {hearing && (
            <p className="m-0 flex items-center gap-2.5 rounded-xl border border-line bg-white px-4 py-2.5 text-[14px] font-medium text-ink">
              <LoaderCircle aria-hidden="true" size={20} strokeWidth={2} className="shrink-0 animate-spin text-brand" />
              {t("hearing")}
            </p>
          )}
        </div>
        {voiceMessage && (
          <p role="alert" className="m-0 rounded-xl bg-alert-tint px-3.5 py-2.5 text-[13.5px] font-semibold text-alert">
            {tRoot(voiceMessage as never)}
          </p>
        )}
        {errorKey && (
          <p role="alert" className="m-0 text-[13.5px] font-semibold text-alert">
            {tRoot(errorKey as never)}
          </p>
        )}
        <form
          aria-label={t("askLabel")}
          onSubmit={(e) => {
            e.preventDefault();
            void submit(state.input);
          }}
          className="flex items-center gap-2"
        >
          <button
            type="button"
            onClick={onMic}
            aria-label={t("mic")}
            aria-pressed={voiceOpen}
            disabled={hearing || state.pending}
            className="flex size-[52px] shrink-0 items-center justify-center rounded-full border-0 bg-brand text-white hover:bg-brand-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-60"
          >
            {voiceOpen ? <X aria-hidden="true" size={24} strokeWidth={1.9} /> : <Mic aria-hidden="true" size={24} strokeWidth={1.9} />}
          </button>
          <div className="relative min-w-0 flex-1">
            <label htmlFor="assistant-ask" className="sr-only">
              {t("askLabel")}
            </label>
            <input
              id="assistant-ask"
              ref={field}
              type="text"
              dir="auto"
              enterKeyHint="send"
              autoComplete="off"
              maxLength={QUESTION_MAX}
              value={state.input}
              disabled={blocked !== null}
              aria-describedby={counterVisible(state.input) ? "assistant-counter" : undefined}
              placeholder={t("askPlaceholder")}
              onChange={(e) => dispatch({ type: "input", text: e.target.value })}
              className="h-12 w-full rounded-xl border border-line bg-white px-3.5 text-[14.5px] text-ink placeholder:text-ink-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-60"
            />
            <span id="assistant-counter" role="status" aria-label={t("counterLabel")} dir="ltr" className="pointer-events-none absolute -top-5 end-1 rounded bg-white px-1 text-[12px] tabular-nums text-ink-2">
              {counterVisible(state.input) ? counterText(state.input) : ""}
            </span>
          </div>
          <button
            type="submit"
            disabled={sendDisabled}
            aria-label={t("send")}
            className="flex size-12 shrink-0 items-center justify-center rounded-xl border border-line bg-white text-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-60"
          >
            <SendHorizontal aria-hidden="true" size={20} strokeWidth={1.9} className="rtl:-scale-x-100" />
          </button>
        </form>
      </div>

      {noticeOpen && (
        <AiNoticeSheet
          open
          version={noticeVersion}
          onClose={() => {
            setNoticeOpen(false);
            dispatch({ type: "unblock" });
            // the dialog gives focus back to what opened it; a question is what comes next
            requestAnimationFrame(() => field.current?.focus());
          }}
        />
      )}
    </ReadAloudProvider>
  );
}
