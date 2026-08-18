import { useCallback, useEffect, useRef, useState } from "react";

export type VoicePhase = "idle" | "listening" | "thinking" | "speaking";

/** Recognition locale + the voice-matching hints for each supported language. */
export const VOICE_LANGS = {
  en: { code: "en-GB", label: "English", match: /^en/i },
  // Dari has no BCP-47 code of its own in any browser engine, so Iranian
  // Persian is the closest available locale. Accent will read as Iranian.
  fa: { code: "fa-IR", label: "فارسی", match: /^fa|persian|farsi/i },
} as const;

export type VoiceLangKey = keyof typeof VOICE_LANGS;

type Options = {
  onUtterance: (text: string) => Promise<string>;
  silenceMs?: number;
  lang?: VoiceLangKey;
};

function getRecognition(): any | null {
  if (typeof window === "undefined") return null;
  const Ctor = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
}

/** Below this many characters, speech heard while Jarvis talks is treated as
 *  echo/noise rather than a real interruption. */
const BARGE_IN_MIN_CHARS = 6;

export function useVoiceMode({ onUtterance, silenceMs = 650, lang = "en" }: Options) {
  const [active, setActive] = useState(false);
  const [phase, setPhase] = useState<VoicePhase>("idle");
  const [transcript, setTranscript] = useState("");
  const [reply, setReply] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [supported, setSupported] = useState(true);

  const recRef = useRef<any>(null);
  const bufferRef = useRef("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeRef = useRef(false);
  const busyRef = useRef(false);
  const warmedRef = useRef(false);
  const speakingRef = useRef(false);
  const interruptedRef = useRef(false);
  const micStreamRef = useRef<MediaStream | null>(null);
  const langRef = useRef<VoiceLangKey>(lang);
  langRef.current = lang;

  useEffect(() => {
    setSupported(
      Boolean(getRecognition()) && typeof window !== "undefined" && "speechSynthesis" in window,
    );
  }, []);

  const clearTimer = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  };

  /** Open the mic once with echo cancellation so the recogniser is far less
   *  likely to transcribe Jarvis's own voice while it speaks. */
  const primeMic = useCallback(async () => {
    if (micStreamRef.current) return;
    if (typeof navigator === "undefined" || !navigator.mediaDevices) return;
    try {
      micStreamRef.current = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch {
      /* Recognition still works; echo suppression just won't be as good. */
    }
  }, []);

  /** Pay the speechSynthesis init cost up front, not on the first real reply. */
  const warmUpSpeech = useCallback(() => {
    if (warmedRef.current) return;
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    warmedRef.current = true;
    try {
      window.speechSynthesis.getVoices();
      const warm = new SpeechSynthesisUtterance(" ");
      warm.volume = 0;
      window.speechSynthesis.speak(warm);
    } catch {
      /* noop */
    }
  }, []);

  const pickVoice = useCallback(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;
    const cfg = VOICE_LANGS[langRef.current];
    const voices = window.speechSynthesis.getVoices();
    if (langRef.current === "fa") {
      // Windows ships no Persian voice by default. If none is installed this
      // returns null and the browser falls back to its default voice.
      return voices.find((v) => cfg.match.test(v.lang) || cfg.match.test(v.name)) ?? null;
    }
    return (
      voices.find((v) => /en-GB/i.test(v.lang) && /male|daniel|arthur|george/i.test(v.name)) ??
      voices.find((v) => /en-GB/i.test(v.lang)) ??
      voices.find((v) => /^en/i.test(v.lang)) ??
      null
    );
  }, []);

  const speak = useCallback(
    (text: string) => {
      return new Promise<void>((resolve) => {
        if (typeof window === "undefined" || !("speechSynthesis" in window)) return resolve();
        if (interruptedRef.current) return resolve();
        const utter = new SpeechSynthesisUtterance(text);
        utter.rate = 1.02;
        utter.pitch = 0.95;
        utter.lang = VOICE_LANGS[langRef.current].code;
        const preferred = pickVoice();
        if (preferred) utter.voice = preferred;
        utter.onend = () => resolve();
        utter.onerror = () => resolve();
        window.speechSynthesis.speak(utter);
      });
    },
    [pickVoice],
  );

  /** Speak sentence by sentence so an interruption can cut in between them. */
  const speakIncremental = useCallback(
    async (text: string) => {
      const sentences =
        text
          .match(/[^.!?\n]+[.!?]*\s*/g)
          ?.map((s) => s.trim())
          .filter(Boolean) ?? [];
      if (!sentences.length) return speak(text);
      for (const sentence of sentences) {
        if (interruptedRef.current) break;
        await speak(sentence);
      }
    },
    [speak],
  );

  /** Cut Jarvis off mid-sentence. */
  const interrupt = useCallback(() => {
    interruptedRef.current = true;
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
  }, []);

  const startListening = useCallback(() => {
    const rec = recRef.current;
    if (!rec || !activeRef.current) return;
    bufferRef.current = "";
    setTranscript("");
    try {
      rec.start();
      setPhase("listening");
    } catch {
      // start() throws if already running — safe to ignore.
    }
  }, []);

  // Some browsers never emit a final result, so whatever has been captured is
  // submitted on a silence timeout instead of waiting for finalisation.
  const flush = useCallback(async () => {
    clearTimer();
    const text = bufferRef.current.trim();
    bufferRef.current = "";
    if (!text || busyRef.current) return;
    busyRef.current = true;
    interruptedRef.current = false;
    setPhase("thinking");
    try {
      const answer = await onUtterance(text);
      if (interruptedRef.current) return;
      setReply(answer);
      setPhase("speaking");
      speakingRef.current = true;
      await speakIncremental(answer);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      setPhase("speaking");
      speakingRef.current = true;
      await speak("Something went wrong. Check the message on screen.");
    } finally {
      speakingRef.current = false;
      busyRef.current = false;
      if (activeRef.current) {
        bufferRef.current = "";
        setTranscript("");
        setPhase("listening");
      } else {
        setPhase("idle");
      }
    }
  }, [onUtterance, speak, speakIncremental]);

  const stop = useCallback(() => {
    activeRef.current = false;
    speakingRef.current = false;
    interruptedRef.current = true;
    setActive(false);
    clearTimer();
    try {
      recRef.current?.stop();
    } catch {
      /* noop */
    }
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;
    setPhase("idle");
  }, []);

  const start = useCallback(() => {
    setError(null);
    warmUpSpeech();
    void primeMic();
    const rec = getRecognition();
    if (!rec) {
      setSupported(false);
      setError(
        "This browser has no SpeechRecognition support. Chrome or Edge on desktop works best.",
      );
      return;
    }
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = VOICE_LANGS[langRef.current].code;

    rec.onresult = (event: any) => {
      let text = "";
      for (let i = 0; i < event.results.length; i++) text += event.results[i][0].transcript;

      // Barge-in: the recogniser keeps running while Jarvis talks, so a long
      // enough utterance cuts the reply off instead of queueing behind it.
      if (speakingRef.current || busyRef.current) {
        if (text.trim().length < BARGE_IN_MIN_CHARS) return;
        interrupt();
        if (busyRef.current && !speakingRef.current) return; // request still in flight
        speakingRef.current = false;
        busyRef.current = false;
        setPhase("listening");
      }

      bufferRef.current = text;
      setTranscript(text);
      clearTimer();
      timerRef.current = setTimeout(() => void flush(), silenceMs);
    };

    rec.onerror = (event: any) => {
      if (event?.error === "no-speech" || event?.error === "aborted") return;
      setError(`Speech recognition error: ${event?.error ?? "unknown"}`);
    };

    rec.onend = () => {
      // Chrome ends the session after a pause; keep the loop alive.
      if (activeRef.current) setTimeout(() => startListening(), 200);
    };

    recRef.current = rec;
    activeRef.current = true;
    setActive(true);
    startListening();
  }, [flush, interrupt, primeMic, silenceMs, startListening, warmUpSpeech]);

  useEffect(() => () => stop(), [stop]);

  return { active, phase, transcript, reply, error, supported, start, stop, interrupt };
}
