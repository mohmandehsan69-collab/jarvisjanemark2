import { useCallback, useEffect, useRef, useState } from "react";

export type VoicePhase = "idle" | "listening" | "thinking" | "speaking";

type Options = {
  onUtterance: (text: string) => Promise<string>;
  silenceMs?: number;
};

function getRecognition(): any | null {
  if (typeof window === "undefined") return null;
  const Ctor = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
}

export function useVoiceMode({ onUtterance, silenceMs = 1400 }: Options) {
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

  useEffect(() => {
    setSupported(Boolean(getRecognition()) && typeof window !== "undefined" && "speechSynthesis" in window);
  }, []);

  const clearTimer = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  };

  const speak = useCallback((text: string) => {
    return new Promise<void>((resolve) => {
      if (typeof window === "undefined" || !("speechSynthesis" in window)) return resolve();
      const utter = new SpeechSynthesisUtterance(text);
      utter.rate = 1.02;
      utter.pitch = 0.95;
      const voices = window.speechSynthesis.getVoices();
      const preferred =
        voices.find((v) => /en-GB/i.test(v.lang) && /male|daniel|arthur|george/i.test(v.name)) ??
        voices.find((v) => /en-GB/i.test(v.lang)) ??
        voices.find((v) => /en/i.test(v.lang));
      if (preferred) utter.voice = preferred;
      utter.onend = () => resolve();
      utter.onerror = () => resolve();
      window.speechSynthesis.speak(utter);
    });
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
      // start() throws if already running — that is safe to ignore.
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
    try {
      recRef.current?.stop();
    } catch {
      /* already stopped */
    }
    setPhase("thinking");
    try {
      const answer = await onUtterance(text);
      setReply(answer);
      setPhase("speaking");
      await speak(answer);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      setPhase("speaking");
      await speak("Something went wrong. Check the message on screen.");
    } finally {
      busyRef.current = false;
      if (activeRef.current) startListening();
      else setPhase("idle");
    }
  }, [onUtterance, speak, startListening]);

  const stop = useCallback(() => {
    activeRef.current = false;
    setActive(false);
    clearTimer();
    try {
      recRef.current?.stop();
    } catch {
      /* noop */
    }
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    setPhase("idle");
  }, []);

  const start = useCallback(() => {
    setError(null);
    const rec = getRecognition();
    if (!rec) {
      setSupported(false);
      setError("This browser has no SpeechRecognition support. Chrome or Edge on desktop works best.");
      return;
    }
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-GB";
    rec.onresult = (event: any) => {
      let text = "";
      for (let i = 0; i < event.results.length; i++) text += event.results[i][0].transcript;
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
      if (activeRef.current && !busyRef.current) {
        // Restart: Chrome ends the session after a pause.
        setTimeout(() => startListening(), 250);
      }
    };
    recRef.current = rec;
    activeRef.current = true;
    setActive(true);
    startListening();
  }, [flush, silenceMs, startListening]);

  useEffect(() => () => stop(), [stop]);

  return { active, phase, transcript, reply, error, supported, start, stop };
}