import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Eye, Flame, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Page, Empty, errorText } from "@/components/app/Page";
import { supabase } from "@/integrations/supabase/client";
import { newDrill, submitDrill } from "@/lib/jarvis.functions";

const title = "Deduction training";
const description =
  "Scenario, observation, memory-palace and cold-reading drills. Jarvis grades the reasoning, not just the conclusion, and difficulty scales with your performance.";

export const Route = createFileRoute("/_authenticated/deduction")({
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
  component: DeductionPage,
});

const DRILL_TYPES = [
  { value: "scenario", label: "Scenario" },
  { value: "observation", label: "Observation" },
  { value: "memory_palace", label: "Memory palace" },
  { value: "cold_reading", label: "Cold reading" },
] as const;
type DrillType = (typeof DRILL_TYPES)[number]["value"];

function DeductionPage() {
  const [drillType, setDrillType] = useState<DrillType>("scenario");
  const [response, setResponse] = useState("");
  const [current, setCurrent] = useState<{
    id: string;
    prompt: string;
    recall_due: string | null;
    difficulty: number;
  } | null>(null);
  const [result, setResult] = useState<{
    reasoningScore: number;
    accuracyScore: number;
    feedback: string;
  } | null>(null);
  const qc = useQueryClient();
  const gen = useServerFn(newDrill);
  const grade = useServerFn(submitDrill);

  const history = useQuery({
    queryKey: ["deduction_attempts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("deduction_attempts")
        .select("id,drill_type,difficulty,reasoning_score,accuracy_score,completed_at,created_at")
        .not("completed_at", "is", null)
        .order("created_at", { ascending: false })
        .limit(60);
      if (error) throw new Error(error.message);
      return data;
    },
  });

  const next = useMutation({
    mutationFn: (type: DrillType) => gen({ data: { drillType: type } }),
    onSuccess: ({ row }) => {
      setCurrent(row);
      setResult(null);
      setResponse("");
    },
    onError: (error) => toast.error(errorText(error)),
  });

  const submit = useMutation({
    mutationFn: () => grade({ data: { drillId: current!.id, response: response.trim() } }),
    onSuccess: (r) => {
      setResult(r);
      void qc.invalidateQueries({ queryKey: ["deduction_attempts"] });
    },
    onError: (error) => toast.error(errorText(error)),
  });

  const recallLocked = current?.recall_due
    ? new Date(current.recall_due).getTime() > Date.now()
    : false;

  const chartData = DRILL_TYPES.map(({ value, label }) => {
    const rows = (history.data ?? []).filter((r) => r.drill_type === value);
    const avg = (key: "reasoning_score" | "accuracy_score") =>
      rows.length ? rows.reduce((s, r) => s + (r[key] ?? 0), 0) / rows.length : 0;
    return {
      label,
      reasoning: Math.round(avg("reasoning_score")),
      accuracy: Math.round(avg("accuracy_score")),
    };
  });

  const streak = (() => {
    const days = new Set(
      (history.data ?? []).map((r) => new Date(r.created_at).toISOString().slice(0, 10)),
    );
    let count = 0;
    for (let i = 0; ; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      if (days.has(d.toISOString().slice(0, 10))) count++;
      else break;
    }
    return count;
  })();

  return (
    <Page eyebrow="Observation" title="Deduction training" intro={description} wide>
      <div className="flex flex-wrap gap-2">
        {DRILL_TYPES.map((t) => (
          <Button
            key={t.value}
            size="sm"
            variant={drillType === t.value ? "default" : "outline"}
            onClick={() => setDrillType(t.value)}
          >
            {t.label}
          </Button>
        ))}
        <Button
          size="sm"
          className="gap-2"
          disabled={next.isPending}
          onClick={() => next.mutate(drillType)}
        >
          <Sparkles className="size-3.5" /> New drill
        </Button>
        {streak > 0 ? (
          <span className="ml-auto flex items-center gap-1 text-xs text-warn">
            <Flame className="size-3.5" /> {streak} day streak
          </span>
        ) : null}
      </div>

      {current ? (
        <div className="panel mt-6 p-5">
          <p className="label-mono">
            {DRILL_TYPES.find((t) => t.value === drillType)?.label} · difficulty{" "}
            {current.difficulty}/5
          </p>
          <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed">{current.prompt}</p>

          {!result ? (
            recallLocked ? (
              <p className="mt-4 text-sm text-warn">
                This drill tests delayed recall — come back at{" "}
                {new Date(current.recall_due!).toLocaleTimeString()} to answer.
              </p>
            ) : (
              <form
                className="mt-4 space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (response.trim()) submit.mutate();
                }}
              >
                <Textarea
                  rows={5}
                  value={response}
                  onChange={(e) => setResponse(e.target.value)}
                  placeholder="What do you deduce? Show your reasoning, not just your conclusion."
                />
                <Button type="submit" disabled={submit.isPending || !response.trim()}>
                  {submit.isPending ? "Grading…" : "Submit"}
                </Button>
              </form>
            )
          ) : (
            <div className="mt-4 space-y-3 rounded-lg border border-border p-4">
              <div className="flex gap-6">
                <div>
                  <p className="label-mono">Reasoning</p>
                  <p className="text-2xl font-semibold">{result.reasoningScore}</p>
                </div>
                <div>
                  <p className="label-mono">Accuracy</p>
                  <p className="text-2xl font-semibold">{result.accuracyScore}</p>
                </div>
              </div>
              <p className="text-sm leading-relaxed text-muted-foreground">{result.feedback}</p>
            </div>
          )}
        </div>
      ) : (
        <div className="mt-6">
          <Empty>Pick a drill type and tap "New drill" to begin.</Empty>
        </div>
      )}

      {history.data?.length ? (
        <div className="panel mt-8 p-5">
          <p className="label-mono flex items-center gap-2">
            <Eye className="size-3.5" /> Average scores by drill type
          </p>
          <div className="mt-3 h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid
                  stroke="var(--color-border)"
                  strokeDasharray="3 3"
                  vertical={false}
                />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
                />
                <YAxis
                  domain={[0, 100]}
                  tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }}
                  width={28}
                />
                <Tooltip
                  contentStyle={{
                    background: "var(--color-surface-2)",
                    border: "1px solid var(--color-border)",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Bar dataKey="reasoning" fill="var(--color-primary)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="accuracy" fill="var(--color-amber)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      ) : null}
    </Page>
  );
}
