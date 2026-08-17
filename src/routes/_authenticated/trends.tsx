import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ArrowDownRight, ArrowUpRight, Minus, Radar } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Page, Empty, errorText } from "@/components/app/Page";
import { supabase } from "@/integrations/supabase/client";
import { scanTrends } from "@/lib/jarvis.functions";

const title = "Trend scanner";
const description =
  "Web-grounded trend scans for any niche: what is rising, falling or steady right now, with the signal and sources behind each call.";

export const Route = createFileRoute("/_authenticated/trends")({
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
  component: TrendsPage,
});

type Trend = { topic: string; direction: string; reasoning: string; sources: string[] };

const arrow = { rising: ArrowUpRight, falling: ArrowDownRight, steady: Minus } as const;

function TrendsPage() {
  const [keyword, setKeyword] = useState("");
  const qc = useQueryClient();
  const run = useServerFn(scanTrends);

  const scans = useQuery({
    queryKey: ["trend_queries"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("trend_queries")
        .select("id,keyword,results,created_at")
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw new Error(error.message);
      return data;
    },
  });

  const scan = useMutation({
    mutationFn: (value: string) => run({ data: { keyword: value } }),
    onSuccess: () => {
      setKeyword("");
      toast.success("Scan complete.");
      void qc.invalidateQueries({ queryKey: ["trend_queries"] });
    },
    onError: (error) => toast.error(errorText(error)),
  });

  return (
    <Page eyebrow="Research" title="Trends" intro={description} wide>
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (keyword.trim().length > 1) scan.mutate(keyword.trim());
        }}
      >
        <Input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="e.g. home solar batteries, calisthenics gear, LLM tooling"
          className="max-w-md"
        />
        <Button type="submit" disabled={scan.isPending} className="gap-2">
          <Radar className="size-4" />
          {scan.isPending ? "Scanning…" : "Scan"}
        </Button>
      </form>

      <div className="mt-8 space-y-6">
        {scans.isLoading ? <Empty>Loading…</Empty> : null}
        {scans.data?.length === 0 ? <Empty>No scans yet.</Empty> : null}
        {scans.data?.map((row) => (
          <section key={row.id} className="panel p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-semibold">{row.keyword}</h2>
              <p className="label-mono">{new Date(row.created_at).toLocaleString()}</p>
            </div>
            <ul className="mt-4 grid gap-3 sm:grid-cols-2">
              {((row.results ?? []) as unknown as Trend[]).map((t, i) => {
                const Icon = arrow[(t.direction as keyof typeof arrow) ?? "steady"] ?? Minus;
                return (
                  <li key={`${row.id}-${i}`} className="rounded-lg border border-border p-4">
                    <div className="flex items-start gap-2">
                      <Icon
                        className={`mt-0.5 size-4 shrink-0 ${
                          t.direction === "rising"
                            ? "text-ok"
                            : t.direction === "falling"
                              ? "text-destructive"
                              : "text-muted-foreground"
                        }`}
                      />
                      <h3 className="text-sm font-semibold leading-snug">{t.topic}</h3>
                    </div>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                      {t.reasoning}
                    </p>
                    {t.sources?.length ? (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {t.sources.slice(0, 3).map((url) => (
                          <a
                            key={url}
                            href={url}
                            target="_blank"
                            rel="noreferrer"
                            className="font-mono text-[0.65rem] text-primary underline-offset-4 hover:underline"
                          >
                            source
                          </a>
                        ))}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </Page>
  );
}