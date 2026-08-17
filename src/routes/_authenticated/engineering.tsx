import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Wrench } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Page, errorText } from "@/components/app/Page";
import { askEngineering } from "@/lib/jarvis.functions";

const title = "Engineering Q&A";
const description =
  "Step-by-step engineering answers with stated assumptions, worked calculations, units, sanity checks and the standard each clause came from.";

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
  const run = useMutation({
    mutationFn: () => ask({ data: { question: question.trim() } }),
    onError: (error) => toast.error(errorText(error)),
  });

  return (
    <Page eyebrow="Technical" title="Engineering" intro={description}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (question.trim().length > 3) run.mutate();
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
          {run.isPending ? "Working…" : "Ask"}
        </Button>
      </form>

      {run.data ? (
        <article className="panel mt-8 p-5">
          <p className="label-mono">Answer · via {run.data.provider}</p>
          <p className="mt-3 text-sm leading-relaxed whitespace-pre-wrap">{run.data.answer}</p>
          {run.data.sources.length ? (
            <ul className="mt-4 space-y-1">
              {run.data.sources.slice(0, 8).map((s) => (
                <li key={s.url}>
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-[0.7rem] text-primary underline-offset-4 hover:underline"
                  >
                    {s.title || s.url}
                  </a>
                </li>
              ))}
            </ul>
          ) : null}
          <p className="mt-4 text-xs text-warn">
            Safety-critical work must be checked and signed off by a licensed engineer.
          </p>
        </article>
      ) : null}
    </Page>
  );
}
