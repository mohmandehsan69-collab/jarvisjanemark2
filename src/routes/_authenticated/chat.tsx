import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Send, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Page, Empty, errorText } from "@/components/app/Page";
import { supabase } from "@/integrations/supabase/client";
import { jarvisChat } from "@/lib/jarvis.functions";

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
            {ask.isPending ? (
              <p className="label-mono animate-pulse">Jarvis is thinking…</p>
            ) : null}
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

        <aside className="panel h-fit p-5">
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
                <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{note.value}</p>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </Page>
  );
}