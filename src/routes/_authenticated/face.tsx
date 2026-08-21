import { createFileRoute } from "@tanstack/react-router";
import { Mic, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Page } from "@/components/app/Page";
import { AmbientFace } from "@/components/AmbientFace";
import { useState } from "react";
import { useVoiceMode, VOICE_LANGS, type VoiceLangKey } from "@/hooks/useVoiceMode";
import { useVoiceRouter } from "@/lib/voice-router";

const title = "Ambient face mode — hands-free Jarvis";
const description =
  "Hands-free voice mode: Jarvis listens, thinks and speaks in a loop using the browser's built-in speech APIs, with a reactive radar visual.";

export const Route = createFileRoute("/_authenticated/face")({
  head: () => ({
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: FacePage,
});

const phaseCopy = {
  idle: "Tap to begin",
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Speaking",
} as const;

function FacePage() {
  const [lang, setLang] = useState<VoiceLangKey>("en");
  const onRoute = useVoiceRouter();
  const voice = useVoiceMode({ lang, onRoute });

  // ACTIVE: break out of the sidebar layout entirely — true fullscreen hologram.
  if (voice.active) {
    return (
      <div className="fixed inset-0 z-50 overflow-hidden bg-[#07070a]">
        <button
          type="button"
          onClick={() => voice.interrupt()}
          aria-label="Interrupt"
          className="absolute inset-0 size-full cursor-default"
        >
          <AmbientFace
            phase={voice.phase}
            active={voice.active}
            className="absolute inset-0 size-full"
          />
        </button>

        <button
          type="button"
          onClick={() => voice.stop()}
          aria-label="Exit ambient mode"
          className="absolute right-5 top-5 z-10 flex items-center gap-2 rounded-full border border-[#ff6b1a]/40 bg-black/40 px-4 py-2 text-xs tracking-widest text-[#ffc766] uppercase backdrop-blur-sm transition hover:bg-[#ff6b1a]/20"
        >
          <Square className="size-3.5" /> Exit
        </button>

        <div className="absolute left-5 top-5 z-10 flex gap-1 rounded-full border border-[#ff6b1a]/30 bg-black/40 p-1 backdrop-blur-sm">
          {(Object.keys(VOICE_LANGS) as VoiceLangKey[]).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setLang(key)}
              className={`rounded-full px-3 py-1 text-xs transition ${
                lang === key
                  ? "bg-[#ff6b1a]/30 text-[#ffc766]"
                  : "text-white/50 hover:text-white/80"
              }`}
            >
              {VOICE_LANGS[key].label}
            </button>
          ))}
        </div>

        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex flex-col items-center gap-3 bg-gradient-to-t from-black/80 to-transparent px-6 pb-10 pt-20 text-center">
          <p className="text-xs tracking-[0.3em] text-[#ffc766] uppercase">
            {phaseCopy[voice.phase]}
          </p>
          <p className="min-h-6 max-w-2xl text-sm leading-relaxed text-white/70">
            {voice.transcript || "Say something."}
          </p>
          {voice.reply ? (
            <p className="max-w-2xl text-base leading-relaxed whitespace-pre-wrap text-white/95">
              {voice.reply}
            </p>
          ) : null}
          {voice.error ? (
            <p className="max-w-2xl text-sm leading-relaxed text-red-400">{voice.error}</p>
          ) : null}
        </div>
      </div>
    );
  }

  // IDLE: normal page with the sidebar, tap the orb to go fullscreen.
  return (
    <Page eyebrow="Voice" title="Ambient face" intro={description}>
      <div className="panel flex flex-col items-center gap-8 p-8 sm:p-12">
        <button
          type="button"
          onClick={() => voice.start()}
          aria-label="Enter ambient mode"
          className="relative flex size-64 items-center justify-center overflow-hidden rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring sm:size-80"
        >
          <AmbientFace phase={voice.phase} active={false} className="absolute inset-0 size-full" />
          <span className="relative flex size-16 items-center justify-center rounded-full bg-[#ff6b1a]/20 text-[#ffc766] backdrop-blur-sm">
            <Mic className="size-7" />
          </span>
        </button>

        <div className="flex gap-2">
          {(Object.keys(VOICE_LANGS) as VoiceLangKey[]).map((key) => (
            <Button
              key={key}
              type="button"
              variant={lang === key ? "default" : "outline"}
              size="sm"
              onClick={() => setLang(key)}
            >
              {VOICE_LANGS[key].label}
            </Button>
          ))}
        </div>

        <div className="text-center">
          <p className="label-mono">{phaseCopy[voice.phase]}</p>
          {voice.error ? (
            <p className="mt-4 max-w-xl text-sm leading-relaxed text-destructive">{voice.error}</p>
          ) : null}
          {!voice.supported ? (
            <p className="mt-4 max-w-xl text-sm text-warn">
              This browser does not expose SpeechRecognition. Chrome or Edge on desktop works; use
              the Chat tab otherwise.
            </p>
          ) : null}
        </div>

        <p className="max-w-xl text-center text-xs leading-relaxed text-muted-foreground">
          Speech is sent after a short pause rather than waiting for the browser to finalise the
          transcript, because some browsers never do and silently drop input. Say what you want and
          Jarvis will jump to the right tab and run it — "make a 3D model of a 12 storey building",
          "prepare this on the engineering tab", or just talk.
        </p>
      </div>
    </Page>
  );
}
