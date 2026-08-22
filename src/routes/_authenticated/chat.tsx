import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Monitor, MonitorOff, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Page, Empty, errorText } from "@/components/app/Page";
import { supabase } from "@/integrations/supabase/client";
import { jarvisChat, shareScreen } from "@/lib/jarvis.functions";

const title = "Chat with Jarvis";
const description =
  "Talk to Jarvis with persistent long-term memory: durable facts are stored separately from the transcript and injected into every reply.";

export const Route = createFileRoute("/_authenticated/chat")({
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
  component: ChatPage,
});

function ChatPage() {
  const [draft, setDraft] = useState("");
  const qc = useQueryClient();
  const send = useServerFn(jarvisChat);
  const bottom = useRef<HTMLDivElement>(null);
  const screen = useScreenShare();

  const messages = useQuery({
    queryKey: ["chat_messages"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("chat_messages")
        .select("id,role,content,provider,created_at")
        .order("created_at", { ascending: true })
        .limit(200);
      if (error) throw new Error(error.message);
      return data;
    },
  });

  const memories = useQuery({
    queryKey: ["memory_notes"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("memory_notes")
        .select("id,key,value")
        .order("updated_at", { ascending: false })
        .limit(40);
      if (error) throw new Error(error.message);
      return data;
    },
  });

  const ask = useMutation({
    mutationFn: (message: string) => send({ data: { message } }),
    onSuccess: (result) => {
      setDraft("");
      if (result.savedMemory) toast.success(`Remembered: ${result.savedMemory.key}`);
      qc.invalidateQueries({ queryKey: ["chat_messages"] });
      qc.invalidateQueries({ queryKey: ["memory_notes"] });
    },
    onError: (error) => toast.error(errorText(error)),
  });

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.data?.length, ask.isPending]);

  async function forget(id: string) {
    const { error } = await supabase.from("memory_notes").delete().eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    void qc.invalidateQueries({ queryKey: ["memory_notes"] });
  }

  return (
    <Page eyebrow="Home" title="Chat" intro={description} wide>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="panel flex min-h-[28rem] flex-col p-4 sm:p-6">
          <div className="flex-1 space-y-4 overflow-y-auto">
            {messages.isLoading ? <Empty>Loading conversation…</Empty> : null}
            {messages.error ? <Empty>{errorText(messages.error)}</Empty> : null}
            {messages.data?.length === 0 ? <Empty>No messages yet. Say something.</Empty> : null}
            {messages.data?.map((m) => (
              <div
                key={m.id}
                className={
                  m.role === "user"
                    ? "ml-auto max-w-[85%] rounded-lg bg-primary/15 px-4 py-2.5 text-sm leading-relaxed"
                    : "max-w-[92%] rounded-lg bg-surface-2 px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap"
                }
              >
                {m.content}
                {m.role === "assistant" && m.provider ? (
                  <span className="mt-2 block font-mono text-[0.65rem] text-muted-foreground">
                    via {m.provider}
                  </span>
                ) : null}
              </div>
            ))}
            {ask.isPending ? <p className="label-mono animate-pulse">Jarvis is thinking…</p> : null}
            <div ref={bottom} />
          </div>

          <form
            className="mt-4 flex items-end gap-2 border-t border-border pt-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (draft.trim()) ask.mutate(draft.trim());
            }}
          >
            <Textarea
              rows={2}
              value={draft}
              placeholder="Ask anything, or tell Jarvis something to remember."
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (draft.trim()) ask.mutate(draft.trim());
                }
              }}
            />
            <Button type="submit" disabled={ask.isPending || !draft.trim()} size="icon">
              <Send className="size-4" />
            </Button>
          </form>
        </div>

        <aside className="space-y-6">
          <div className="panel h-fit p-5">
            <p className="label-mono">Long-term memory</p>
            <ul className="mt-3 space-y-2">
              {memories.data?.length === 0 ? (
                <li className="text-sm text-muted-foreground">Nothing stored yet.</li>
              ) : null}
              {memories.data?.map((note) => (
                <li key={note.id} className="rounded-md border border-border px-3 py-2">
                  <div className="flex items-start justify-between gap-2">
                    <Badge variant="outline" className="font-mono text-[0.6rem]">
                      {note.key}
                    </Badge>
                    <button
                      onClick={() => forget(note.id)}
                      aria-label={`Forget ${note.key}`}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                  <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                    {note.value}
                  </p>
                </li>
              ))}
            </ul>
          </div>

          <div className="panel h-fit p-5">
            <div className="flex items-center justify-between gap-2">
              <p className="label-mono">Screen share</p>
              {screen.active ? (
                <span className="flex items-center gap-1 text-[0.65rem] text-warn">
                  <span className="size-1.5 animate-pulse rounded-full bg-warn" /> sharing
                </span>
              ) : null}
            </div>
            {screen.active ? (
              <div className="mt-3 space-y-3">
                <video
                  ref={screen.videoRef}
                  muted
                  autoPlay
                  playsInline
                  className="w-full rounded-md border border-border"
                />
                <div className="flex gap-2">
                  <Input
                    value={screen.question}
                    onChange={(e) => screen.setQuestion(e.target.value)}
                    placeholder="Ask about what's on screen…"
                    onKeyDown={(e) => e.key === "Enter" && screen.ask()}
                  />
                  <Button size="sm" onClick={() => screen.ask()} disabled={screen.busy}>
                    Ask
                  </Button>
                </div>
                {screen.answer ? (
                  <p className="rounded-md bg-surface-2 p-3 text-xs leading-relaxed">
                    {screen.answer}
                  </p>
                ) : null}
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full gap-2"
                  onClick={() => screen.stop()}
                >
                  <MonitorOff className="size-3.5" /> Stop sharing
                </Button>
              </div>
            ) : (
              <Button
                size="sm"
                variant="outline"
                className="mt-3 w-full gap-2"
                onClick={() => screen.start()}
              >
                <Monitor className="size-3.5" /> Share screen
              </Button>
            )}
          </div>
        </aside>
      </div>
    </Page>
  );
}

/** Spec §3.4: explicit, user-initiated screen share. One tab or window per
 *  share (the browser picker enforces this), stops in one tap, never
 *  background or persistent. */
function useScreenShare() {
  const analyze = useServerFn(shareScreen);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [active, setActive] = useState(false);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);

  async function start() {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      streamRef.current = stream;
      stream.getVideoTracks()[0]?.addEventListener("ended", () => stop());
      if (videoRef.current) videoRef.current.srcObject = stream;
      setActive(true);
      setAnswer("");
    } catch (error) {
      toast.error(errorText(error));
    }
  }

  function stop() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setActive(false);
    setAnswer("");
  }

  async function ask() {
    const video = videoRef.current;
    if (!video || !question.trim()) return;
    setBusy(true);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext("2d")?.drawImage(video, 0, 0);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
      const base64 = dataUrl.split(",")[1] ?? "";
      const result = await analyze({ data: { base64, mimeType: "image/jpeg", question } });
      setAnswer(result.answer);
      setQuestion("");
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => () => streamRef.current?.getTracks().forEach((t) => t.stop()), []);

  return { active, videoRef, question, setQuestion, answer, busy, start, stop, ask };
}
