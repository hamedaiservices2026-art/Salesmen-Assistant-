"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Mic, Square, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { elapsedLabel, MAX_RECORD_MS, pickRecorderMime, recorderErrorKind, recorderSupport } from "@/ui/recorder";

type Phase = "idle" | "asking" | "recording";

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
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<"denied" | "failed" | null>(null);
  const [elapsed, setElapsed] = useState(0);
  // What the browser supports is known only in the browser (null while rendering on the server).
  const support = useSyncExternalStore(noSubscription, browserSupport, serverSupport);

  const stream = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  // Each start gets a number; a start that was cancelled (or unmounted) before the microphone answered stops its stream at once.
  const attempt = useRef(0);
  const emit = useRef(onRecorded);
  useEffect(() => {
    emit.current = onRecorded;
  });

  const release = useCallback(() => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
  }, []);

  /** Stops recording; `keep` sends what was recorded, otherwise it is thrown away. */
  const finish = useCallback(
    (keep: boolean) => {
      attempt.current += 1;
      const r = recorder.current;
      recorder.current = null;
      if (r && r.state !== "inactive") {
        if (!keep) r.ondataavailable = null;
        r.onstop = () => {
          const type = r.mimeType || "audio/webm";
          const blob = new Blob(chunks.current, { type });
          chunks.current = [];
          release();
          if (!keep) return;
          if (blob.size === 0) setError("failed");
          else emit.current(blob);
        };
        try {
          r.stop();
        } catch {
          release();
        }
      } else {
        chunks.current = [];
        release();
      }
      setPhase("idle");
      setElapsed(0);
    },
    [release],
  );

  useEffect(() => {
    // A page that is hidden (another app, a locked phone) stops the microphone; the recording is dropped.
    const onHidden = () => {
      if (document.visibilityState === "hidden") finish(false);
    };
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      attempt.current += 1;
      const r = recorder.current;
      recorder.current = null;
      if (r && r.state !== "inactive") {
        r.ondataavailable = null;
        r.onstop = null;
        try {
          r.stop();
        } catch {
          // already stopped
        }
      }
      release();
    };
  }, [finish, release]);

  async function start() {
    setError(null);
    const mine = ++attempt.current;
    setPhase("asking");
    let media: MediaStream;
    try {
      media = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      if (mine !== attempt.current) return;
      setPhase("idle");
      setError(recorderErrorKind(e instanceof Error ? e.name : undefined));
      return;
    }
    if (mine !== attempt.current) {
      media.getTracks().forEach((track) => track.stop());
      return;
    }
    stream.current = media;
    try {
      const mime = pickRecorderMime((m) => MediaRecorder.isTypeSupported(m));
      const r = mime ? new MediaRecorder(media, { mimeType: mime }) : new MediaRecorder(media);
      chunks.current = [];
      r.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.current.push(e.data);
      };
      r.onerror = () => {
        finish(false);
        setError("failed");
      };
      recorder.current = r;
      r.start();
    } catch {
      release();
      setPhase("idle");
      setError("failed");
      return;
    }
    const startedAt = Date.now();
    setElapsed(0);
    setPhase("recording");
    timer.current = setInterval(() => {
      const ms = Date.now() - startedAt;
      setElapsed(ms);
      if (ms >= MAX_RECORD_MS) finish(true);
    }, 250);
  }

  function picked(files: FileList | null) {
    const file = files?.[0];
    if (file) onRecorded(file);
  }

  const message = error === "denied" ? t("denied") : error === "failed" ? t("failed") : null;

  return (
    <div className="flex flex-col gap-3 rounded-[14px] border border-line bg-white p-4">
      {phase === "recording" ? (
        <div className="flex flex-col items-center gap-3" role="group" aria-label={t("recording")}>
          <p aria-live="off" dir="ltr" className="m-0 text-[28px] font-bold leading-none text-ink">
            {elapsedLabel(elapsed)}
            <span className="text-[16px] font-medium text-ink-2"> / {elapsedLabel(MAX_RECORD_MS)}</span>
          </p>
          <button type="button" onClick={() => finish(true)} className={`${BTN} min-h-14 min-w-56 border-0 bg-brand px-6 text-white hover:bg-brand-hover`}>
            <Square aria-hidden="true" size={20} strokeWidth={2.2} fill="currentColor" />
            {t("stop")}
          </button>
          <button type="button" onClick={() => finish(false)} className={`${BTN} min-h-11 border border-line bg-white px-4 text-[14px] font-semibold text-ink`}>
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
