import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { Mic, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Page } from "@/components/app/Page";
import { AmbientFace } from "@/components/AmbientFace";
import { useVoiceMode } from "@/hooks/useVoiceMode";
import { jarvisChat } from "@/lib/jarvis.functions";

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
  const chat = useServerFn(jarvisChat);
  const qc = useQueryClient();
  const voice = useVoiceMode({
    onUtterance: async (text) => {
      const result = await chat({ data: { message: text, voice: true } });
      void qc.invalidateQueries({ queryKey: ["chat_messages"] });
      void qc.invalidateQueries({ queryKey: ["memory_notes"] });
      return result.reply;
    },
  });

  return (
    <Page eyebrow="Voice" title="Ambient face" intro={description}>
      <div className="panel flex flex-col items-center gap-8 p-8 sm:p-12">
        <button
          type="button"
          onClick={() => (voice.active ? voice.stop() : voice.start())}
          aria-label={voice.active ? "Exit ambient mode" : "Enter ambient mode"}
          className="relative flex size-64 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring sm:size-80"
        >
          <AmbientFace
            phase={voice.phase}
            active={voice.active}
            className="absolute inset-0 size-full"
          />
          <span className="relative flex size-16 items-center justify-center rounded-full bg-[#ff6b1a]/20 text-[#ffc766] backdrop-blur-sm">
            {voice.active ? <Square className="size-6" /> : <Mic className="size-7" />}
          </span>
        </button>

        <div className="text-center">
          <p className="label-mono">{phaseCopy[voice.phase]}</p>
          <p className="mt-3 min-h-6 max-w-xl text-sm leading-relaxed text-muted-foreground">
            {voice.transcript || (voice.active ? "Say something." : "")}
          </p>
          {voice.reply ? (
            <p className="mt-4 max-w-xl text-sm leading-relaxed whitespace-pre-wrap">{voice.reply}</p>
          ) : null}
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

        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => voice.stop()} disabled={!voice.active}>
            Exit
          </Button>
        </div>

        <p className="max-w-xl text-center text-xs leading-relaxed text-muted-foreground">
          Speech is sent after a short pause rather than waiting for the browser to finalise the
          transcript, because some browsers never do and silently drop input.
        </p>
      </div>
    </Page>
  );
}