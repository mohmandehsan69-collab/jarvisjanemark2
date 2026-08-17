import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
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
import { supabase } from "@/integrations/supabase/client";
import { researchTopic } from "@/lib/jarvis.functions";

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

  const reports = useQuery({
    queryKey: ["research_reports"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("research_reports")
        .select("id,topic,output_type,body,sources,created_at")
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw new Error(error.message);
      return data;
    },
  });

  const research = useMutation({
    mutationFn: () => run({ data: { topic: topic.trim(), outputType } }),
    onSuccess: () => {
      setTopic("");
      toast.success("Report ready.");
      void qc.invalidateQueries({ queryKey: ["research_reports"] });
    },
    onError: (error) => toast.error(errorText(error)),
  });

  const promote = useMutation({
    mutationFn: async (report: { id: string; topic: string; body: string }) => {
      const { error } = await supabase.from("projects").insert({
        user_id: (await supabase.auth.getUser()).data.user!.id,
        title: report.topic,
        summary: report.body.slice(0, 600),
        source_report_id: report.id,
      });
      if (error) throw new Error(error.message);
    },
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
          if (topic.trim().length > 2) research.mutate();
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
                disabled={promote.isPending}
                onClick={() => promote.mutate({ id: r.id, topic: r.topic, body: r.body })}
              >
                <FolderPlus className="size-3.5" /> Turn into project
              </Button>
            </div>
            <p className="mt-4 text-sm leading-relaxed whitespace-pre-wrap text-foreground/90">
              {r.body}
            </p>
            {Array.isArray(r.sources) && r.sources.length ? (
              <ul className="mt-4 space-y-1">
                {(r.sources as unknown as { title: string; url: string }[]).slice(0, 8).map((s) => (
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
          </article>
        ))}
      </div>
    </Page>
  );
}