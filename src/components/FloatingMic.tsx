import { useState } from "react";
import { useLocation } from "@tanstack/react-router";
import { Mic, Square, X } from "lucide-react";
import { useVoiceMode } from "@/hooks/useVoiceMode";
import { useVoiceRouter } from "@/lib/voice-router";
import { cn } from "@/lib/utils";

const phaseCopy = {
  idle: "Tap to talk",
  listening: "Listening…",
  thinking: "Thinking…",
  speaking: "Speaking…",
} as const;

/** Spec §3.2: a persistent floating mic on every page. Tapping it runs the
 *  same listen → think → speak loop as Face mode, inline as a small overlay,
 *  with the same routing to other tabs — without navigating away first. */
export function FloatingMic() {
  const location = useLocation();
  const onRoute = useVoiceRouter();
  const voice = useVoiceMode({ onRoute });
  const [expanded, setExpanded] = useState(false);

  // The Face tab already is this experience, fullscreen — avoid a redundant
  // floating control stacked on top of it.
  if (location.pathname.startsWith("/face")) return null;

  const on = voice.active;

  return (
    <div className="fixed bottom-20 right-4 z-40 flex flex-col items-end gap-2 lg:bottom-6 lg:right-6">
      {expanded && on ? (
        <div className="w-64 rounded-xl border border-[#ff6b1a]/30 bg-black/85 p-4 text-white backdrop-blur-md">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[0.65rem] tracking-[0.25em] text-[#ffc766] uppercase">
              {phaseCopy[voice.phase]}
            </p>
            <button
              type="button"
              aria-label="Close voice overlay"
              onClick={() => setExpanded(false)}
              className="text-white/50 hover:text-white"
            >
              <X className="size-3.5" />
            </button>
          </div>
          <p className="mt-2 min-h-8 text-xs leading-relaxed text-white/70">
            {voice.transcript || "Say something — Jarvis can jump to any tab and run it."}
          </p>
          {voice.reply ? (
            <p className="mt-2 max-h-32 overflow-y-auto text-xs leading-relaxed whitespace-pre-wrap text-white/95">
              {voice.reply}
            </p>
          ) : null}
          {voice.error ? <p className="mt-2 text-xs text-red-400">{voice.error}</p> : null}
        </div>
      ) : null}

      <button
        type="button"
        aria-label={on ? "Stop voice mode" : "Start voice mode"}
        onClick={() => {
          if (on) {
            voice.stop();
            setExpanded(false);
          } else {
            voice.start();
            setExpanded(true);
          }
        }}
        onDoubleClick={() => on && voice.interrupt()}
        className={cn(
          "flex size-14 items-center justify-center rounded-full border shadow-lg backdrop-blur-md transition",
          on
            ? "border-[#ff6b1a]/60 bg-[#ff6b1a]/25 text-[#ffc766] animate-pulse"
            : "border-border bg-surface text-foreground hover:bg-surface-2",
        )}
      >
        {on ? <Square className="size-5" /> : <Mic className="size-5" />}
      </button>
    </div>
  );
}
