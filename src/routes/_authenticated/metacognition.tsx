import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Brain, Gauge, Sparkles } from "lucide-react";
import { toast } from "sonner";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  ComposedChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Page, Empty, errorText } from "@/components/app/Page";
import { metacognitionStats, newMetacognition, submitMetacognition } from "@/lib/jarvis.functions";

const title = "Metacognition training";
const description =
  "Calibration training: state your confidence before you answer, then see whether your confidence actually tracks your accuracy.";

export const Route = createFileRoute("/_authenticated/metacognition")({
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
  component: MetacognitionPage,
});

const DRILL_TYPES = [
  { value: "prediction", label: "Prediction" },
  { value: "reasoning_trace", label: "Reasoning trace" },
  { value: "change_my_mind", label: "What would change my mind" },
] as const;
type DrillType = (typeof DRILL_TYPES)[number]["value"];

function MetacognitionPage() {
  const [drillType, setDrillType] = useState<DrillType>("prediction");
  const [current, setCurrent] = useState<{ id: string; prompt: string } | null>(null);
  const [confidence, setConfidence] = useState(50);
  const [locked, setLocked] = useState(false);
  const [response, setResponse] = useState("");
  const [result, setResult] = useState<{
    correct: boolean | null;
    score: number;
    biasesIdentified: string[];
    feedback: string;
  } | null>(null);
  const qc = useQueryClient();
  const gen = useServerFn(newMetacognition);
  const submitFn = useServerFn(submitMetacognition);
  const getStats = useServerFn(metacognitionStats);

  const stats = useQuery({
    queryKey: ["metacognition_stats"],
    queryFn: () => getStats(),
  });

  const next = useMutation({
    mutationFn: (type: DrillType) => gen({ data: { drillType: type } }),
    onSuccess: ({ row }) => {
      setCurrent(row);
      setResult(null);
      setResponse("");
      setConfidence(50);
      setLocked(false);
    },
    onError: (error) => toast.error(errorText(error)),
  });

  const submit = useMutation({
    mutationFn: () =>
      submitFn({
        data: { attemptId: current!.id, confidencePct: confidence, response: response.trim() },
      }),
    onSuccess: (r) => {
      setResult(r);
      void qc.invalidateQueries({ queryKey: ["metacognition_stats"] });
    },
    onError: (error) => toast.error(errorText(error)),
  });

  const calibrationData = (stats.data?.calibration ?? []).map((b) => ({
    range: b.range,
    confidence: b.avgConfidence != null ? Math.round(b.avgConfidence) : null,
    accuracy: b.accuracy != null ? Math.round(b.accuracy * 100) : null,
    count: b.count,
  }));

  return (
    <Page eyebrow="Calibration" title="Metacognition training" intro={description} wide>
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
      </div>

      {current ? (
        <div className="panel mt-6 p-5">
          <p className="label-mono">{DRILL_TYPES.find((t) => t.value === drillType)?.label}</p>
          <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed">{current.prompt}</p>

          {!result ? (
            !locked ? (
              <div className="mt-5 space-y-4 rounded-lg border border-border p-4">
                <p className="text-sm font-semibold">Before you answer: how confident are you?</p>
                <div className="flex items-center gap-4">
                  <Slider
                    value={[confidence]}
                    onValueChange={([v]) => setConfidence(v ?? 50)}
                    max={100}
                    step={5}
                    className="max-w-sm"
                  />
                  <span className="w-14 font-mono text-lg">{confidence}%</span>
                </div>
                <Button size="sm" onClick={() => setLocked(true)}>
                  Lock in confidence
                </Button>
              </div>
            ) : (
              <form
                className="mt-4 space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (response.trim()) submit.mutate();
                }}
              >
                <p className="text-xs text-muted-foreground">
                  Confidence locked at{" "}
                  <span className="font-mono text-foreground">{confidence}%</span>.
                </p>
                <Textarea
                  rows={5}
                  value={response}
                  onChange={(e) => setResponse(e.target.value)}
                  placeholder="Your answer and reasoning…"
                />
                <Button type="submit" disabled={submit.isPending || !response.trim()}>
                  {submit.isPending ? "Grading…" : "Submit"}
                </Button>
              </form>
            )
          ) : (
            <div className="mt-4 space-y-3 rounded-lg border border-border p-4">
              <div className="flex flex-wrap items-center gap-4">
                {result.correct !== null ? (
                  <Badge variant={result.correct ? "default" : "destructive"}>
                    {result.correct ? "Correct" : "Incorrect"}
                  </Badge>
                ) : null}
                <div>
                  <p className="label-mono">Score</p>
                  <p className="text-2xl font-semibold">{result.score}</p>
                </div>
                <div>
                  <p className="label-mono">You said</p>
                  <p className="text-2xl font-semibold">{confidence}%</p>
                </div>
              </div>
              {result.biasesIdentified.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {result.biasesIdentified.map((b) => (
                    <Badge key={b} variant="outline">
                      {b}
                    </Badge>
                  ))}
                </div>
              ) : null}
              <p className="text-sm leading-relaxed text-muted-foreground">{result.feedback}</p>
            </div>
          )}
        </div>
      ) : (
        <div className="mt-6">
          <Empty>Pick a drill type and tap "New drill" to begin.</Empty>
        </div>
      )}

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <div className="panel p-5">
          <p className="label-mono flex items-center gap-2">
            <Gauge className="size-3.5" /> Brier score
          </p>
          <p className="mt-2 text-3xl font-semibold">
            {stats.data?.brierScore != null ? stats.data.brierScore.toFixed(3) : "—"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Lower is better calibrated. 0 is perfect, 0.25 is coin-flip guessing at 50%, 1 is
            confidently wrong every time.
          </p>
        </div>
        <div className="panel p-5">
          <p className="label-mono flex items-center gap-2">
            <Brain className="size-3.5" /> Most common biases
          </p>
          {stats.data?.topBiases.length ? (
            <ul className="mt-2 space-y-1">
              {stats.data.topBiases.map((b) => (
                <li key={b.name} className="flex justify-between text-sm">
                  <span>{b.name}</span>
                  <span className="font-mono text-muted-foreground">{b.count}×</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">Not enough graded drills yet.</p>
          )}
        </div>
      </div>

      {calibrationData.some((d) => d.count > 0) ? (
        <div className="panel mt-4 p-5">
          <p className="label-mono">
            Calibration curve — confidence vs. actual accuracy (prediction drills)
          </p>
          <div className="mt-3 h-56">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={calibrationData}
                margin={{ top: 4, right: 8, left: -20, bottom: 0 }}
              >
                <CartesianGrid
                  stroke="var(--color-border)"
                  strokeDasharray="3 3"
                  vertical={false}
                />
                <XAxis
                  dataKey="range"
                  tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }}
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
                <Bar
                  dataKey="accuracy"
                  name="Actual accuracy %"
                  fill="var(--color-ok)"
                  radius={[4, 4, 0, 0]}
                />
                <Line
                  type="monotone"
                  dataKey="confidence"
                  name="Avg. stated confidence %"
                  stroke="var(--color-amber)"
                  strokeWidth={2}
                  dot
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Well-calibrated means the bars track the line — your confidence roughly equals your
            actual hit rate.
          </p>
        </div>
      ) : null}
    </Page>
  );
}
