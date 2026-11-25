"use client";

import { createContext, useContext, useEffect, useId, useRef, useState } from "react";
import { Square, Volume2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import type { Locale } from "@/i18n/config";
import { pickVoice, speakable, takeHintOnce } from "@/ui/speech";

/** How long the phone gets to list its voices (they often arrive after the page). */
const VOICES_WAIT_MS = 1500;
const memory = { shown: false };

type Found = { phase: "wait" } | { phase: "none" } | { phase: "ready"; voice: SpeechSynthesisVoice };
type Api = { found: Found; hint: boolean; speakingId: string | null; toggle: (id: string, text: string) => void };
const Voices = createContext<Api | null>(null);

/**
 * One voice detection and one speaker for every read-aloud button on the screen. It looks for a
 * voice of the rep's language once (waiting at most 1.5 s for the list), speaks only from a tap,
 * and stops on a second tap, when the page is hidden or left, and when it unmounts (a route
 * change). Only one answer is read at a time.
 */
export function ReadAloudProvider({ children }: { children: React.ReactNode }) {
  const locale = useLocale() as Locale;
  const [found, setFound] = useState<Found>({ phase: "wait" });
  const [hint, setHint] = useState(false);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const current = useRef<SpeechSynthesisUtterance | null>(null);

  useEffect(() => {
    const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
    let done = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (next: Found) => {
      done = true;
      setFound(next);
      // No voice: the hint, once per device.
      if (next.phase === "none" && takeHintOnce(() => window.localStorage, memory)) setHint(true);
    };
    const settle = (final: boolean) => {
      if (done) return;
      if (!synth) return finish({ phase: "none" });
      const voices = synth.getVoices();
      const i = pickVoice(voices, locale);
      if (i !== null) finish({ phase: "ready", voice: voices[i]! });
      else if (final || voices.length > 0) finish({ phase: "none" });
    };
    const onChange = () => settle(false);
    synth?.addEventListener?.("voiceschanged", onChange);
    settle(false);
    if (!done) timer = setTimeout(() => settle(true), VOICES_WAIT_MS);
    return () => {
      done = true;
      if (timer) clearTimeout(timer);
      synth?.removeEventListener?.("voiceschanged", onChange);
    };
  }, [locale]);

  useEffect(() => {
    const stop = () => {
      if (!current.current) return;
      current.current = null;
      window.speechSynthesis?.cancel();
      setSpeakingId(null);
    };
    const onHidden = () => {
      if (document.visibilityState === "hidden") stop();
    };
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", stop);
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pagehide", stop);
      if (current.current) {
        current.current = null;
        window.speechSynthesis?.cancel();
      }
    };
  }, []);

  function toggle(id: string, text: string) {
    if (found.phase !== "ready") return;
    const synth = window.speechSynthesis;
    if (speakingId === id) {
      current.current = null;
      synth.cancel();
      setSpeakingId(null);
      return;
    }
    const say = speakable(text);
    if (say === "") return;
    // Only something already speaking has to be stopped first.
    if (synth.speaking || synth.pending) synth.cancel();
    const u = new SpeechSynthesisUtterance(say);
    u.voice = found.voice;
    u.lang = found.voice.lang;
    const end = () => {
      if (current.current === u) {
        current.current = null;
        setSpeakingId(null);
      }
    };
    u.onend = end;
    u.onerror = end;
    current.current = u;
    setSpeakingId(id);
    synth.speak(u);
  }

  return <Voices.Provider value={{ found, hint, speakingId, toggle }}>{children}</Voices.Provider>;
}

/** The once-per-device line saying the phone has no voice for this language (own element, own row). */
export function NoVoiceHint({ className = "" }: { className?: string }) {
  const t = useTranslations("assistant");
  const api = useContext(Voices);
  if (!api?.hint) return null;
  return (
    <p role="status" className={`m-0 text-[12.5px] text-ink-2 ${className}`}>
      {t("noVoice")}
    </p>
  );
}

/** The read-aloud button: nothing until the phone has a voice for the language. */
export function ReadAloud({ text, className = "" }: { text: string; className?: string }) {
  const t = useTranslations("assistant");
  const id = useId();
  const api = useContext(Voices);
  if (!api || api.found.phase !== "ready") return null;
  const speaking = api.speakingId === id;
  return (
    <button
      type="button"
      onClick={() => api.toggle(id, text)}
      aria-pressed={speaking}
      className={`inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[10px] border border-line bg-white px-3.5 py-1.5 text-[14px] font-semibold text-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${className}`}
    >
      {speaking ? <Square aria-hidden="true" size={16} strokeWidth={2} fill="currentColor" /> : <Volume2 aria-hidden="true" size={18} strokeWidth={1.9} />}
      {speaking ? t("stop") : t("listen")}
    </button>
  );
}
