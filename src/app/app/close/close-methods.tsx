"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Camera, LoaderCircle, Mic, Pencil } from "lucide-react";
import { useTranslations } from "next-intl";
import type { DraftRead } from "@/domain/ai/draft-session";
import { AiNoticeSheet } from "@/ui/components/AiNotice";
import { AiUnavailable, type AiUnavailableReason } from "@/ui/components/AiUnavailable";
import { VoiceRecorder } from "@/ui/components/VoiceRecorder";
import { readErrorKey, readFromAi, type ReadKind } from "@/ui/ai-client";
import { downscalePhoto } from "@/ui/photo-client";

export type AiStatus = { available: boolean; reason: AiUnavailableReason | null };

type Mode = "type" | "photo" | "voice";

const base = "flex min-h-16 flex-col items-center justify-center gap-0.5 rounded-xl px-1 py-2 text-[13px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";
const pressed = `${base} border-2 border-brand bg-brand-tint font-bold text-brand disabled:opacity-60`;
const idle = `${base} border border-line bg-white font-medium text-ink disabled:opacity-60`;

/**
 * The three ways to record the day: the report photo, a voice note, typing. Reading is offered only
 * when the rep's status allows it; otherwise the button stays visible, says why, and typing stays
 * selected. A button that needs the one-time notice opens the notice first. A request can be
 * abandoned at any time by choosing typing; a draft arrives through `onRead` and is never saved.
 */
export function CloseMethods({
  date,
  vision,
  stt,
  noticeVersion,
  onRead,
}: {
  date: string;
  vision: AiStatus;
  stt: AiStatus;
  noticeVersion: number;
  onRead: (read: DraftRead) => void;
}) {
  const t = useTranslations("close");
  const tRoot = useTranslations();
  const [mode, setMode] = useState<Mode>("type");
  const [busy, setBusy] = useState<ReadKind | null>(null);
  const [failure, setFailure] = useState<{ kind: ReadKind; reason: string; transcript?: string } | null>(null);
  const [unavailable, setUnavailable] = useState<AiUnavailableReason | null>(null);
  const [noticeOpen, setNoticeOpen] = useState(false);
  const photoInput = useRef<HTMLInputElement>(null);
  const request = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      request.current?.abort();
    },
    [],
  );

  function cancelRequest() {
    request.current?.abort();
    request.current = null;
    setBusy(null);
  }

  /** The status gate shared by both buttons; true when the action may go on. */
  function allowed(status: AiStatus): boolean {
    setFailure(null);
    if (status.available) {
      setUnavailable(null);
      return true;
    }
    cancelRequest();
    setMode("type");
    if (status.reason === "no_notice") setNoticeOpen(true);
    else setUnavailable(status.reason ?? "failed");
    return false;
  }

  async function send(kind: ReadKind, blob: () => Promise<Blob>) {
    cancelRequest();
    const ctl = new AbortController();
    request.current = ctl;
    setBusy(kind);
    setFailure(null);
    let body: Blob;
    try {
      body = await blob();
    } catch {
      if (request.current !== ctl) return;
      request.current = null;
      setBusy(null);
      setFailure({ kind, reason: "unreadable" });
      return;
    }
    if (ctl.signal.aborted) return;
    const r = await readFromAi(kind, date, body, { signal: ctl.signal });
    if (request.current !== ctl) return;
    request.current = null;
    setBusy(null);
    if (r.ok) onRead({ draft: r.draft, draftId: r.draftId, ...(r.transcript ? { transcript: r.transcript } : {}) });
    else if (r.reason === "no_notice") {
      // the notice was withdrawn or changed since the page loaded: show it again
      setMode("type");
      setNoticeOpen(true);
    } else if (r.reason !== "cancelled") setFailure({ kind, reason: r.reason, ...(r.transcript ? { transcript: r.transcript } : {}) });
  }

  function onPhoto() {
    if (!allowed(vision)) return;
    photoInput.current?.click();
  }

  function onVoice() {
    if (mode === "voice") {
      cancelRequest();
      setMode("type");
      return;
    }
    if (!allowed(stt)) return;
    setMode("voice");
  }

  function onType() {
    cancelRequest();
    setFailure(null);
    setUnavailable(null);
    setMode("type");
  }

  return (
    <div className="flex flex-col gap-3 px-5 pt-[18px]">
      <div role="group" aria-label={t("methodLabel")} className="grid grid-cols-3 gap-2">
        <button type="button" aria-pressed={mode === "photo"} disabled={busy !== null} onClick={onPhoto} className={mode === "photo" ? pressed : idle}>
          <Camera aria-hidden="true" size={24} strokeWidth={1.8} />
          {t("methodPhoto")}
        </button>
        <button type="button" aria-pressed={mode === "voice"} disabled={busy !== null} onClick={onVoice} className={mode === "voice" ? pressed : idle}>
          <Mic aria-hidden="true" size={24} strokeWidth={1.8} />
          {t("methodVoice")}
        </button>
        <button type="button" aria-pressed={mode === "type"} onClick={onType} className={mode === "type" ? pressed : idle}>
          <Pencil aria-hidden="true" size={24} strokeWidth={1.8} />
          {t("methodType")}
        </button>
      </div>

      {/* Camera, library and files are all offered (no `capture`), so a screenshot of the report can be chosen (R56). */}
      <input
        ref={photoInput}
        type="file"
        accept="image/*"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          setMode("photo");
          void send("photo", () => downscalePhoto(file));
        }}
      />

      {unavailable && <AiUnavailable reason={unavailable} />}

      {mode === "voice" && busy !== "voice" && <VoiceRecorder disabled={busy !== null} onRecorded={(audio) => void send("voice", async () => audio)} />}

      {/* Always mounted, so a screen reader announces the text when it appears. */}
      <div role="status">
        {busy && (
          <p className="m-0 flex items-center gap-2.5 rounded-xl border border-line bg-white px-4 py-3 text-[14px] font-medium text-ink">
            <LoaderCircle aria-hidden="true" size={20} strokeWidth={2} className="shrink-0 animate-spin text-brand" />
            {busy === "photo" ? t("draft.reading") : t("draft.listening")}
          </p>
        )}
      </div>

      {failure && (
        <div role="alert" className="flex flex-col gap-1.5 rounded-xl bg-alert-tint px-3.5 py-2.5 text-[13.5px] font-semibold text-alert">
          <p className="m-0">{tRoot(readErrorKey(failure.kind, failure.reason) as never)}</p>
          {failure.reason === "unauthorized" && (
            <Link href="/signin" className="inline-flex min-h-11 items-center self-start text-[14px] font-bold text-alert underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
              {t("read.signIn")}
            </Link>
          )}
          {failure.transcript && (
            <p className="m-0 font-normal text-ink">
              <span className="font-semibold">{t("draft.heard")}: </span>
              <bdi dir="auto">{failure.transcript}</bdi>
            </p>
          )}
        </div>
      )}

      {/* Mounted only while open, so its buttons are not part of the page otherwise. */}
      {noticeOpen && <AiNoticeSheet open onClose={() => setNoticeOpen(false)} version={noticeVersion} />}
    </div>
  );
}
