import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { persistVoiceReply, speakText } from "@/lib/jarvis.functions";

export type VoicePhase = "idle" | "listening" | "thinking" | "speaking";

/** Recognition locale + the voice-matching hints for each supported language. */
export const VOICE_LANGS = {
  en: { code: "en-GB", label: "English", match: /^en/i, hint: "English" },
  // Dari has no BCP-47 code of its own in any browser engine, so Iranian
  // Persian is the closest available locale. Accent will read as Iranian.
  fa: { code: "fa-IR", label: "فارسی", match: /^fa|persian|farsi/i, hint: "Farsi/Dari" },
} as const;

export type VoiceLangKey = keyof typeof VOICE_LANGS;

type Options = {
  /** Optional: route the utterance to another tab instead of answering inline
   *  (spec §3.1). Return true if it was handled/routed — the loop keeps
   *  listening but does not speak a chat reply. */
  onRoute?: (text: string) => Promise<boolean>;
  silenceMs?: number;
  lang?: VoiceLangKey;
};

function getRecognition(): any | null {
  if (typeof window === "undefined") return null;
  const Ctor = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
}

/** Below this many characters, speech heard while Jarvis talks is ignored
 *  outright — too short to be a real interruption or a matchable echo. */
const BARGE_IN_MIN_CHARS = 6;
/** Spec §5.1: sustained speech required before a barge-in is accepted. */
const BARGE_IN_SUSTAIN_MS = 700;
/** A pause longer than this between recognition results means the previous
 *  sound stopped, so the sustained-speech window restarts. Without this, two
 *  isolated blips seconds apart would satisfy BARGE_IN_SUSTAIN_MS between them
 *  and cut Jarvis off — exactly what the sustain requirement exists to prevent. */
const BARGE_IN_GAP_MS = 400;
/** Spec §5.1: cooldown after Jarvis stops speaking before the mic is trusted. */
const POST_SPEECH_COOLDOWN_MS = 400;
/** Spec §5.1: window after speech ends where transcripts are still checked
 *  against what Jarvis just said, even outside the hard cooldown. */
const ECHO_CHECK_WINDOW_MS = 800;
/** Containment-similarity threshold above which a transcript is treated as
 *  Jarvis hearing itself rather than the user talking. */
const ECHO_SIMILARITY_THRESHOLD = 0.6;
const RECENT_UTTERANCE_LIMIT = 5;

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Word-containment similarity: robust to the mic only catching part of what
 *  Jarvis said (which is the common case for a real echo). */
function similarity(a: string, b: string): number {
  const wa = new Set(normalize(a).split(" ").filter(Boolean));
  const wb = new Set(normalize(b).split(" ").filter(Boolean));
  if (!wa.size || !wb.size) return 0;
  let inter = 0;
  for (const w of wa) if (wb.has(w)) inter++;
  return inter / Math.min(wa.size, wb.size);
}

export function useVoiceMode({ onRoute, silenceMs = 650, lang = "en" }: Options) {
  const [active, setActive] = useState(false);
  const [phase, setPhase] = useState<VoicePhase>("idle");
  const [transcript, setTranscript] = useState("");
  const [reply, setReply] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [supported, setSupported] = useState(true);

  const persistTurn = useServerFn(persistVoiceReply);
  const synthesize = useServerFn(speakText);

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

  // Echo/interruption bookkeeping (spec §5.1).
  const recentUtterancesRef = useRef<{ text: string; at: number }[]>([]);
  const bargeCandidateSinceRef = useRef<number | null>(null);
  const lastResultAtRef = useRef(0);
  const speechEndedAtRef = useRef(0);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const hasLocalVoiceRef = useRef<Record<VoiceLangKey, boolean>>({ en: true, fa: false });

  useEffect(() => {
    setSupported(
      Boolean(getRecognition()) && typeof window !== "undefined" && "speechSynthesis" in window,
    );
  }, []);

  /** Chrome and Edge populate the voice list asynchronously: getVoices()
   *  returns [] until `voiceschanged` fires. Reading it once would leave the
   *  Persian check permanently false and force every Farsi/Dari turn through
   *  server TTS even when a local voice is installed (spec §5.2), so the list
   *  is re-read whenever the browser updates it. */
  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const refresh = () => {
      try {
        const voices = window.speechSynthesis.getVoices();
        if (!voices.length) return;
        hasLocalVoiceRef.current.fa = voices.some(
          (v) => VOICE_LANGS.fa.match.test(v.lang) || VOICE_LANGS.fa.match.test(v.name),
        );
      } catch {
        /* speechSynthesis can throw in locked-down contexts; keep the default. */
      }
    };
    refresh();
    window.speechSynthesis.addEventListener?.("voiceschanged", refresh);
    return () => window.speechSynthesis.removeEventListener?.("voiceschanged", refresh);
  }, []);

  const clearTimer = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  };

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

  const warmUpSpeech = useCallback(() => {
    if (warmedRef.current) return;
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    warmedRef.current = true;
    try {
      // Voice availability is tracked by the `voiceschanged` effect above;
      // this only pays the synthesis init cost up front.
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
      return voices.find((v) => cfg.match.test(v.lang) || cfg.match.test(v.name)) ?? null;
    }
    return (
      voices.find((v) => /en-GB/i.test(v.lang) && /male|daniel|arthur|george/i.test(v.name)) ??
      voices.find((v) => /en-GB/i.test(v.lang)) ??
      voices.find((v) => /^en/i.test(v.lang)) ??
      null
    );
  }, []);

  const remember = useCallback((text: string) => {
    const now = Date.now();
    recentUtterancesRef.current = [
      { text, at: now },
      ...recentUtterancesRef.current.filter((u) => now - u.at < 20_000),
    ].slice(0, RECENT_UTTERANCE_LIMIT);
  }, []);

  /** Spec §5.2: Persian/Dari has no installed browser voice on most systems.
   *  Detect that and fall back to server-generated speech automatically. */
  const speakServerSide = useCallback(
    async (text: string) => {
      try {
        const { base64Wav } = await synthesize({
          data: { text, languageHint: VOICE_LANGS[langRef.current].hint },
        });
        return new Promise<void>((resolve) => {
          const audio = new Audio(`data:audio/wav;base64,${base64Wav}`);
          currentAudioRef.current = audio;
          audio.onended = () => resolve();
          audio.onerror = () => resolve();
          void audio.play().catch(() => resolve());
        });
      } catch (err) {
        console.error("[voice] server speech failed:", err);
      }
    },
    [synthesize],
  );

  const speak = useCallback(
    (text: string) => {
      remember(text);
      if (interruptedRef.current) return Promise.resolve();
      if (langRef.current === "fa" && !hasLocalVoiceRef.current.fa) {
        return speakServerSide(text);
      }
      return new Promise<void>((resolve) => {
        if (typeof window === "undefined" || !("speechSynthesis" in window)) return resolve();
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
    [pickVoice, remember, speakServerSide],
  );

  /** Cut Jarvis off mid-sentence, browser or server-side audio alike. */
  const interrupt = useCallback(() => {
    interruptedRef.current = true;
    if (typeof window !== "undefined" && "speechSynthesis" in window)
      window.speechSynthesis.cancel();
    currentAudioRef.current?.pause();
    currentAudioRef.current = null;
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

  /** Sentence boundary at or after `from`, requiring trailing whitespace so a
   *  mid-stream decimal point/abbreviation isn't treated as the end. */
  function nextSentenceEnd(text: string, from: number): number {
    const re = /[.!?]+/g;
    re.lastIndex = from;
    let m: RegExpExecArray | null;
    let found = -1;
    while ((m = re.exec(text))) {
      const end = m.index + m[0].length;
      if (end < text.length && /\s/.test(text[end] ?? "")) found = end;
    }
    return found;
  }

  const flush = useCallback(async () => {
    clearTimer();
    const text = bufferRef.current.trim();
    bufferRef.current = "";
    if (!text || busyRef.current) return;
    busyRef.current = true;
    interruptedRef.current = false;
    setPhase("thinking");
    setError(null);

    try {
      // Spec §3.1/§3.2: route to another tab if this reads as a request for
      // one, and execute it on arrival rather than only navigating.
      if (onRoute) {
        const routed = await onRoute(text);
        if (routed) {
          if (interruptedRef.current) return;
          setPhase("speaking");
          speakingRef.current = true;
          await speak(langRef.current === "fa" ? "بله، الان انجامش می‌دهم." : "On it.");
          return;
        }
      }

      const token = (await supabase.auth.getSession()).data.session?.access_token;
      const res = await fetch("/api/voice", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ message: text, language: VOICE_LANGS[langRef.current].code }),
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}) as { error?: string });
        throw new Error(body.error ?? `Voice request failed (HTTP ${res.status}).`);
      }

      if (interruptedRef.current) return;
      setPhase("speaking");
      speakingRef.current = true;

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let sseBuffer = "";
      let full = "";
      let spokenUpTo = 0;

      readLoop: while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        sseBuffer += decoder.decode(value, { stream: true });
        const lines = sseBuffer.split("\n");
        sseBuffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (!payload) continue;
          let json: any;
          try {
            json = JSON.parse(payload);
          } catch {
            continue;
          }
          const delta: string = (json?.candidates?.[0]?.content?.parts ?? [])
            .map((p: any) => p?.text ?? "")
            .join("");
          if (!delta) continue;
          full += delta;

          // Never speak the trailing MEMORY: {...} line — cap what we scan
          // for sentence boundaries at wherever it starts, if it has yet.
          const memoryIdx = full.search(/\nMEMORY:\s*\{/);
          const capped = memoryIdx >= 0 ? full.slice(0, memoryIdx) : full;

          let boundary: number;
          while ((boundary = nextSentenceEnd(capped, spokenUpTo)) > spokenUpTo) {
            const sentence = capped.slice(spokenUpTo, boundary).trim();
            spokenUpTo = boundary;
            if (sentence) await speak(sentence);
            if (interruptedRef.current) break readLoop;
          }
        }
      }

      const memoryIdx = full.search(/\nMEMORY:\s*\{/);
      const capped = memoryIdx >= 0 ? full.slice(0, memoryIdx) : full;
      if (!interruptedRef.current && spokenUpTo < capped.length) {
        const tail = capped.slice(spokenUpTo).trim();
        if (tail) await speak(tail);
      }

      const cleaned = capped.trim();
      setReply(cleaned);
      if (full.trim()) {
        void persistTurn({ data: { message: text, reply: full } }).catch((err) =>
          console.error("[voice] failed to persist turn:", err),
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      if (!interruptedRef.current) {
        setPhase("speaking");
        speakingRef.current = true;
        await speak(
          langRef.current === "fa"
            ? "مشکلی پیش آمد. پیام روی صفحه را ببینید."
            : "Something went wrong. Check the message on screen.",
        );
      }
    } finally {
      speakingRef.current = false;
      speechEndedAtRef.current = Date.now();
      bargeCandidateSinceRef.current = null;
      busyRef.current = false;
      if (activeRef.current) {
        bufferRef.current = "";
        setTranscript("");
        setPhase("listening");
      } else {
        setPhase("idle");
      }
    }
  }, [onRoute, persistTurn, speak]);

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
    if (typeof window !== "undefined" && "speechSynthesis" in window)
      window.speechSynthesis.cancel();
    currentAudioRef.current?.pause();
    currentAudioRef.current = null;
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
        "This browser has no SpeechRecognition support. Chrome or Edge on desktop works best — try typing instead.",
      );
      return;
    }
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = VOICE_LANGS[langRef.current].code;

    rec.onresult = (event: any) => {
      let text = "";
      for (let i = 0; i < event.results.length; i++) text += event.results[i][0].transcript;
      if (!text.trim()) return;

      const now = Date.now();
      // Record arrival immediately so every return path below leaves an
      // accurate "last heard sound" mark for the barge-in gap check.
      const prevResultAt = lastResultAtRef.current;
      lastResultAtRef.current = now;

      // Spec §5.1 layer 1: hard cooldown right after Jarvis stops speaking.
      if (
        !speakingRef.current &&
        !busyRef.current &&
        now - speechEndedAtRef.current < POST_SPEECH_COOLDOWN_MS
      ) {
        console.log("[voice] discarded transcript (post-speech cooldown):", text);
        return;
      }

      // Spec §5.1 layer 2: fuzzy-match against what Jarvis recently said,
      // both while speaking and for a short window after.
      const withinEchoWindow =
        speakingRef.current || now - speechEndedAtRef.current < ECHO_CHECK_WINDOW_MS;
      if (withinEchoWindow) {
        for (const u of recentUtterancesRef.current) {
          const sim = similarity(text, u.text);
          if (sim >= ECHO_SIMILARITY_THRESHOLD) {
            console.log(
              `[voice] discarded transcript (echo, similarity ${sim.toFixed(2)} vs "${u.text.slice(0, 60)}"):`,
              text,
            );
            return;
          }
        }
      }

      if (speakingRef.current || busyRef.current) {
        if (text.trim().length < BARGE_IN_MIN_CHARS) {
          console.log("[voice] discarded transcript (too short to be a barge-in):", text);
          return;
        }
        // Spec §5.1 layer 3: require sustained speech before accepting the
        // interruption, so a brief echo blip that didn't fuzzy-match still
        // can't cut Jarvis off. The window restarts after a gap, so "sustained"
        // means continuous sound rather than two blips far apart.
        if (bargeCandidateSinceRef.current === null || now - prevResultAt > BARGE_IN_GAP_MS) {
          bargeCandidateSinceRef.current = now;
        }
        if (now - bargeCandidateSinceRef.current < BARGE_IN_SUSTAIN_MS) return;
        interrupt();
        speakingRef.current = false;
        busyRef.current = false;
        bargeCandidateSinceRef.current = null;
        setPhase("listening");
      }

      bufferRef.current = text;
      setTranscript(text);
      clearTimer();
      timerRef.current = setTimeout(() => void flush(), silenceMs);
    };

    rec.onerror = (event: any) => {
      if (event?.error === "no-speech" || event?.error === "aborted") return;
      if (event?.error === "not-allowed" || event?.error === "service-not-allowed") {
        setError(
          "Microphone access was denied. Allow microphone access to use voice mode, or use text input.",
        );
        setSupported(false);
        return;
      }
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
