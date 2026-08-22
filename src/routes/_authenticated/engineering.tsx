import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Wrench } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Page, errorText } from "@/components/app/Page";
import { CrossCheckView } from "@/components/app/CrossCheckView";
import { askEngineering } from "@/lib/jarvis.functions";
import { consumePendingInstruction } from "@/lib/voice-router";

const title = "Engineering Q&A";
const description =
  "Step-by-step engineering answers with stated assumptions, worked calculations, units and sanity checks — every question is cross-checked with a second independent pass before you see it.";

export const Route = createFileRoute("/_authenticated/engineering")({
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
  component: EngineeringPage,
});

function EngineeringPage() {
  const [question, setQuestion] = useState("");
  const ask = useServerFn(askEngineering);
  const ranPending = useRef(false);
  const run = useMutation({
    mutationFn: (q: string) => ask({ data: { question: q.trim() } }),
    onError: (error) => toast.error(errorText(error)),
  });

  useEffect(() => {
    if (ranPending.current) return;
    ranPending.current = true;
    const pending = consumePendingInstruction();
    if (pending) {
      setQuestion(pending);
      run.mutate(pending);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Page eyebrow="Technical" title="Engineering" intro={description}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (question.trim().length > 3) run.mutate(question);
        }}
      >
        <Textarea
          rows={4}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="e.g. Size a 4 m simply-supported C24 timber joist at 400 mm centres for a domestic floor."
        />
        <Button type="submit" disabled={run.isPending} className="gap-2">
          <Wrench className="size-4" />
          {run.isPending ? "Cross-checking…" : "Ask"}
        </Button>
      </form>

      {run.data ? (
        <article className="panel mt-8 p-5">
          <p className="label-mono">Answer · cross-checked</p>
          <div className="mt-3">
            <CrossCheckView result={run.data} />
          </div>
          <p className="mt-4 text-xs text-warn">
            Safety-critical work must be checked and signed off by a licensed engineer.
          </p>
        </article>
      ) : null}
    </Page>
  );
}
