import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Compass, FolderPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Page, Empty, errorText } from "@/components/app/Page";
import { CrossCheckView, type CrossCheck } from "@/components/app/CrossCheckView";
import { supabase } from "@/integrations/supabase/client";
import { promoteReport, researchTopic } from "@/lib/jarvis.functions";
import { consumePendingInstruction } from "@/lib/voice-router";

const title = "Multi-source research";
const description =
  "Cross-checked research: Jarvis searches from several angles, reconciles disagreements, marks unverified claims, and can promote any report into a project.";

export const Route = createFileRoute("/_authenticated/research")({
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
  component: ResearchPage,
});

const types = [
  { value: "summary", label: "Briefing" },
  { value: "spec", label: "Technical spec" },
  { value: "comparison", label: "Comparison" },
  { value: "draft", label: "Draft document" },
] as const;

function ResearchPage() {
  const [topic, setTopic] = useState("");
  const [outputType, setOutputType] = useState<(typeof types)[number]["value"]>("summary");
  const qc = useQueryClient();
  const run = useServerFn(researchTopic);
  const promote = useServerFn(promoteReport);
  const ranPending = useRef(false);

  const reports = useQuery({
    queryKey: ["research_reports"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("research_reports")
        .select("id,topic,output_type,body,sources,cross_check,created_at")
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw new Error(error.message);
      return data;
    },
  });

  const research = useMutation({
    mutationFn: (t: string) => run({ data: { topic: t.trim(), outputType } }),
    onSuccess: () => {
      setTopic("");
      toast.success("Report ready.");
      void qc.invalidateQueries({ queryKey: ["research_reports"] });
    },
    onError: (error) => toast.error(errorText(error)),
  });

  useEffect(() => {
    if (ranPending.current) return;
    ranPending.current = true;
    const pending = consumePendingInstruction();
    if (pending) {
      setTopic(pending);
      research.mutate(pending);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const promoteMutation = useMutation({
    mutationFn: (reportId: string) => promote({ data: { reportId } }),
    onSuccess: () => {
      toast.success("Added to Projects.");
      void qc.invalidateQueries({ queryKey: ["projects"] });
    },
    onError: (error) => toast.error(errorText(error)),
  });

  return (
    <Page eyebrow="Research" title="Deep research" intro={description} wide>
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (topic.trim().length > 2) research.mutate(topic);
        }}
      >
        <Input
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="What should Jarvis research?"
          className="max-w-md"
        />
        <Select value={outputType} onValueChange={(v) => setOutputType(v as typeof outputType)}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {types.map((t) => (
              <SelectItem key={t.value} value={t.value}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button type="submit" disabled={research.isPending} className="gap-2">
          <Compass className="size-4" />
          {research.isPending ? "Researching…" : "Research"}
        </Button>
      </form>

      <div className="mt-8 space-y-5">
        {reports.isLoading ? <Empty>Loading…</Empty> : null}
        {reports.data?.length === 0 ? <Empty>No reports yet.</Empty> : null}
        {reports.data?.map((r) => (
          <article key={r.id} className="panel p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="label-mono">{r.output_type}</p>
                <h2 className="mt-1 text-base font-semibold">{r.topic}</h2>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                disabled={promoteMutation.isPending}
                onClick={() => promoteMutation.mutate(r.id)}
              >
                <FolderPlus className="size-3.5" /> Turn into project
              </Button>
            </div>
            <div className="mt-4">
              {r.cross_check ? (
                <CrossCheckView result={r.cross_check as unknown as CrossCheck} />
              ) : (
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
                  {r.body}
                </p>
              )}
            </div>
          </article>
        ))}
      </div>
    </Page>
  );
}
