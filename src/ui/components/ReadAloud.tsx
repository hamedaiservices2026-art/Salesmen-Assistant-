"use client";

import { useEffect, useRef, useState } from "react";
import { Square, Volume2 } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import type { Locale } from "@/i18n/config";
import { pickVoice, speakable } from "@/ui/speech";

/** How long the phone gets to list its voices (they often arrive after the page). */
const VOICES_WAIT_MS = 1500;
const HINT_KEY = "assistant.noVoiceHint";

type Found = { phase: "wait" } | { phase: "none" } | { phase: "ready"; voice: SpeechSynthesisVoice };

/** Once per device: true the first time it is asked, false after. Private mode without storage: asked once per page load. */
let hintShownInMemory = false;
function takeHint(): boolean {
  try {
    if (window.localStorage.getItem(HINT_KEY) !== null) return false;
    window.localStorage.setItem(HINT_KEY, "1");
    return true;
  } catch {
    if (hintShownInMemory) return false;
    hintShownInMemory = true;
    return true;
  }
}

/**
 * The read-aloud button, with the phone's own voices only. It renders nothing until the phone has
 * `speechSynthesis` and a voice for the rep's language (waiting at most 1.5 s for the list). It
 * speaks only from a tap, and stops on a second tap, when the page is hidden or left, and when
 * the component goes away (a route change unmounts it). No voice: no button, and once per device
 * the hint that the answer is only written.
 */
export function ReadAloud({ text, className = "", hintClassName = "" }: { text: string; className?: string; hintClassName?: string }) {
  const t = useTranslations("assistant");
  const locale = useLocale() as Locale;
  const [found, setFound] = useState<Found>({ phase: "wait" });
  const [speaking, setSpeaking] = useState(false);
  const [hint, setHint] = useState(false);
  const mine = useRef<SpeechSynthesisUtterance | null>(null);

  useEffect(() => {
    const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
    let done = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (next: Found) => {
      done = true;
      setFound(next);
      // No voice: the hint, once per device.
      if (next.phase === "none" && takeHint()) setHint(true);
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

  // Stops what this button started: on unmount (a route change), when the page is hidden or left.
  useEffect(() => {
    const stop = () => {
      if (mine.current && typeof window !== "undefined") {
        mine.current = null;
        window.speechSynthesis?.cancel();
        setSpeaking(false);
      }
    };
    const onHidden = () => {
      if (document.visibilityState === "hidden") stop();
    };
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", stop);
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pagehide", stop);
      if (mine.current) {
        const synth = window.speechSynthesis;
        mine.current = null;
        synth?.cancel();
      }
    };
  }, []);

  if (found.phase === "none") {
    return hint ? <p className={`m-0 text-[12.5px] text-ink-2 ${hintClassName}`}>{t("noVoice")}</p> : null;
  }
  if (found.phase !== "ready") return null;
  const { voice } = found;

  function toggle() {
    const synth = window.speechSynthesis;
    if (speaking) {
      mine.current = null;
      synth.cancel();
      setSpeaking(false);
      return;
    }
    const say = speakable(text);
    if (say === "") return;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(say);
    u.voice = voice;
    u.lang = voice.lang;
    const end = () => {
      if (mine.current === u) {
        mine.current = null;
        setSpeaking(false);
      }
    };
    u.onend = end;
    u.onerror = end;
    mine.current = u;
    setSpeaking(true);
    synth.speak(u);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={speaking}
      className={`inline-flex min-h-11 items-center justify-center gap-1.5 rounded-[10px] border border-line bg-white px-3.5 text-[14px] font-semibold text-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${className}`}
    >
      {speaking ? <Square aria-hidden="true" size={16} strokeWidth={2} fill="currentColor" /> : <Volume2 aria-hidden="true" size={18} strokeWidth={1.9} />}
      {speaking ? t("stop") : t("listen")}
    </button>
  );
}
