import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Sun } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Page, Empty, errorText } from "@/components/app/Page";
import { supabase } from "@/integrations/supabase/client";
import { morningBriefing } from "@/lib/jarvis.functions";

const title = "Morning briefing";
const description =
  "One briefing per day: weather for your saved location, active habits, open tasks and what Jarvis thinks you should focus on.";

export const Route = createFileRoute("/_authenticated/briefing")({
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
  component: BriefingPage,
});

function BriefingPage() {
  const qc = useQueryClient();
  const run = useServerFn(morningBriefing);

  const briefings = useQuery({
    queryKey: ["briefings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("briefings")
        .select("id,day,trends_blurb,weather")
        .order("day", { ascending: false })
        .limit(14);
      if (error) throw new Error(error.message);
      return data;
    },
  });

  const generate = useMutation({
    mutationFn: () => run({ data: undefined }),
    onSuccess: (result) => {
      toast.success(result.cached ? "Today's briefing was already written." : "Briefing ready.");
      void qc.invalidateQueries({ queryKey: ["briefings"] });
    },
    onError: (error) => toast.error(errorText(error)),
  });

  return (
    <Page
      eyebrow="Daily"
      title="Morning briefing"
      intro={description}
      actions={
        <Button onClick={() => generate.mutate()} disabled={generate.isPending} className="gap-2">
          <Sun className="size-4" />
          {generate.isPending ? "Writing…" : "Today's briefing"}
        </Button>
      }
    >
      <div className="space-y-4">
        {briefings.isLoading ? <Empty>Loading…</Empty> : null}
        {briefings.data?.length === 0 ? (
          <Empty>No briefings yet. Generate today's.</Empty>
        ) : null}
        {briefings.data?.map((b) => {
          const weather = (b.weather ?? {}) as Record<string, unknown>;
          return (
            <article key={b.id} className="panel p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="label-mono">{b.day}</p>
                {typeof weather["now_c"] === "number" ? (
                  <p className="font-mono text-xs text-muted-foreground">
                    {String(weather["now_c"])}°C now · {String(weather["low_c"])}–
                    {String(weather["high_c"])}°C · rain {String(weather["rain_chance"])}%
                  </p>
                ) : typeof weather["error"] === "string" ? (
                  <p className="font-mono text-xs text-warn">{String(weather["error"])}</p>
                ) : null}
              </div>
              <p className="mt-3 text-sm leading-relaxed whitespace-pre-wrap">{b.trends_blurb}</p>
            </article>
          );
        })}
      </div>
    </Page>
  );
}