"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Mic, Square, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { elapsedLabel, MAX_RECORD_MS, recorderSupport } from "@/ui/recorder";
import { createRecorder, type RecorderLike, type RecorderPhase, type StreamLike } from "@/ui/recorder-controller";

const BTN =
  "inline-flex items-center justify-center gap-2 rounded-xl text-base font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";

const noSubscription = () => () => undefined;
const serverSupport = (): null => null;
function browserSupport(): "ok" | "unsupported" {
  return recorderSupport({
    mediaDevices: typeof navigator.mediaDevices?.getUserMedia === "function",
    mediaRecorder: typeof MediaRecorder !== "undefined",
    secure: window.isSecureContext,
  });
}

/**
 * Records one voice note and hands the caller one `Blob` (the type the browser produced; the server
 * sniffs it). The microphone is asked for only from the tap on the start button, and every track
 * is stopped when the rep stops, when the page is left or hidden, on an error and on unmount; a
 * recording stops by itself at 60 s. Where the browser cannot record (no microphone API, no
 * MediaRecorder, an insecure page) the button is replaced by a file picker for an existing
 * recording (audio only, no `capture`: iOS Safari offers no recorder through a file input; R56).
 */
export function VoiceRecorder({ onRecorded, disabled = false }: { onRecorded: (audio: Blob) => void; disabled?: boolean }) {
  const t = useTranslations("close.voice");
  const [phase, setPhase] = useState<RecorderPhase>("idle");
  const [error, setError] = useState<"denied" | "failed" | null>(null);
  const [elapsed, setElapsed] = useState(0);
  // A recording cut short because the page was hidden: kept, and the rep decides what to do with it.
  const [kept, setKept] = useState<Blob | null>(null);
  // What the browser supports is known only in the browser (null while rendering on the server).
  const support = useSyncExternalStore(noSubscription, browserSupport, serverSupport);

  const control = useRef<ReturnType<typeof createRecorder> | null>(null);
  const emit = useRef(onRecorded);
  useEffect(() => {
    emit.current = onRecorded;
  });

  useEffect(() => {
    const c = createRecorder(
      {
        getUserMedia: () => navigator.mediaDevices.getUserMedia({ audio: true }) as Promise<StreamLike>,
        makeRecorder: (stream, mime) => new MediaRecorder(stream as MediaStream, mime ? { mimeType: mime } : undefined) as unknown as RecorderLike,
        isTypeSupported: (m) => MediaRecorder.isTypeSupported(m),
      },
      {
        onPhase: (p) => {
          setPhase(p);
          if (p === "idle") setElapsed(0);
        },
        onTick: setElapsed,
        onResult: ({ blob, reason }) => {
          if (reason === "hidden") setKept(blob);
          else emit.current(blob);
        },
        onError: setError,
      },
    );
    control.current = c;
    // A page that is hidden (another app, a locked phone) stops the microphone; what was recorded is kept, never dropped silently.
    const onHidden = () => {
      if (document.visibilityState === "hidden") c.hidden();
    };
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      c.dispose();
      control.current = null;
    };
  }, []);

  function start() {
    setError(null);
    setKept(null);
    void control.current?.start();
  }

  function picked(files: FileList | null) {
    const file = files?.[0];
    if (file) onRecorded(file);
  }

  const message = error === "denied" ? t("denied") : error === "failed" ? t("failed") : null;
  const recording = phase === "recording" || phase === "stopping";

  return (
    <div className="flex flex-col gap-3 rounded-[14px] border border-line bg-white p-4">
      {kept ? (
        <div className="flex flex-col gap-3" role="group" aria-label={t("hiddenStopped")}>
          <p role="status" className="m-0 rounded-xl bg-brand-tint px-3.5 py-2.5 text-[13.5px] font-semibold text-ink">
            {t("hiddenStopped")}
          </p>
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              const blob = kept;
              setKept(null);
              onRecorded(blob);
            }}
            className={`${BTN} min-h-[52px] border-0 bg-brand px-5 text-white hover:bg-brand-hover disabled:opacity-60`}
          >
            {t("sendKept")}
          </button>
          <button type="button" onClick={start} className={`${BTN} min-h-11 border border-line bg-white px-4 text-[14px] font-semibold text-ink`}>
            <Mic aria-hidden="true" size={18} strokeWidth={2} />
            {t("again")}
          </button>
        </div>
      ) : recording ? (
        <div className="flex flex-col items-center gap-3" role="group" aria-label={t("recording")}>
          <p aria-live="off" dir="ltr" className="m-0 text-[28px] font-bold leading-none text-ink">
            {elapsedLabel(elapsed)}
            <span className="text-[16px] font-medium text-ink-2"> / {elapsedLabel(MAX_RECORD_MS)}</span>
          </p>
          <button
            type="button"
            disabled={phase === "stopping"}
            onClick={() => control.current?.stop()}
            className={`${BTN} min-h-14 min-w-56 border-0 bg-brand px-6 text-white hover:bg-brand-hover disabled:opacity-60`}
          >
            <Square aria-hidden="true" size={20} strokeWidth={2.2} fill="currentColor" />
            {t("stop")}
          </button>
          <button type="button" onClick={() => control.current?.cancel()} className={`${BTN} min-h-11 border border-line bg-white px-4 text-[14px] font-semibold text-ink`}>
            <X aria-hidden="true" size={18} strokeWidth={2} />
            {t("cancel")}
          </button>
        </div>
      ) : support === "unsupported" ? (
        <label className={`${BTN} min-h-[52px] cursor-pointer border border-line bg-white px-5 text-brand ${disabled ? "opacity-60" : ""}`}>
          <Mic aria-hidden="true" size={20} strokeWidth={2} />
          {t("pickFile")}
          <input type="file" accept="audio/*" disabled={disabled} className="sr-only" onChange={(e) => picked(e.target.files)} />
        </label>
      ) : (
        <button
          type="button"
          onClick={start}
          disabled={disabled || phase === "asking" || support === null}
          className={`${BTN} min-h-[52px] border-0 bg-brand px-5 text-white hover:bg-brand-hover disabled:opacity-60`}
        >
          <Mic aria-hidden="true" size={20} strokeWidth={2} />
          {t("start")}
        </button>
      )}
      <p className="m-0 text-[13px] text-ink-2">{t("hint")}</p>
      {message && (
        <p role="alert" className="m-0 rounded-xl bg-alert-tint px-3.5 py-2.5 text-[13.5px] font-semibold text-alert">
          {message}
        </p>
      )}
    </div>
  );
}
