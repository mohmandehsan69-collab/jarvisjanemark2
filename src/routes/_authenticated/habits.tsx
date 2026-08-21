import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Check, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Page, Empty, errorText } from "@/components/app/Page";
import { supabase } from "@/integrations/supabase/client";

const title = "Habit tracker";
const description =
  "Track daily habits with streaks: tap a day to log it, and Jarvis can reference your habits everywhere in the app.";

export const Route = createFileRoute("/_authenticated/habits")({
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
  component: HabitsPage,
});

function isoDaysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

const week = Array.from({ length: 7 }, (_, i) => isoDaysAgo(6 - i));
const month = Array.from({ length: 30 }, (_, i) => isoDaysAgo(29 - i));

function HabitsPage() {
  const [name, setName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const qc = useQueryClient();

  const habits = useQuery({
    queryKey: ["habits"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("habits")
        .select("id,name,archived")
        .eq("archived", false)
        .order("created_at");
      if (error) throw new Error(error.message);
      return data;
    },
  });

  const logs = useQuery({
    queryKey: ["habit_logs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("habit_logs")
        .select("id,habit_id,log_date")
        .gte("log_date", month[0]!);
      if (error) throw new Error(error.message);
      return data;
    },
  });

  const add = useMutation({
    mutationFn: async () => {
      const userId = (await supabase.auth.getUser()).data.user!.id;
      const { error } = await supabase
        .from("habits")
        .insert({ user_id: userId, name: name.trim() });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      setName("");
      void qc.invalidateQueries({ queryKey: ["habits"] });
    },
    onError: (error) => toast.error(errorText(error)),
  });

  const rename = useMutation({
    mutationFn: async ({ id, value }: { id: string; value: string }) => {
      const { error } = await supabase.from("habits").update({ name: value.trim() }).eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      setEditingId(null);
      void qc.invalidateQueries({ queryKey: ["habits"] });
    },
    onError: (error) => toast.error(errorText(error)),
  });

  const toggle = useMutation({
    mutationFn: async ({ habitId, day }: { habitId: string; day: string }) => {
      const existing = logs.data?.find((l) => l.habit_id === habitId && l.log_date === day);
      if (existing) {
        const { error } = await supabase.from("habit_logs").delete().eq("id", existing.id);
        if (error) throw new Error(error.message);
        return;
      }
      const userId = (await supabase.auth.getUser()).data.user!.id;
      const { error } = await supabase
        .from("habit_logs")
        .insert({ user_id: userId, habit_id: habitId, log_date: day });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["habit_logs"] }),
    onError: (error) => toast.error(errorText(error)),
  });

  const archive = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("habits").update({ archived: true }).eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["habits"] }),
    onError: (error) => toast.error(errorText(error)),
  });

  function streak(habitId: string) {
    let count = 0;
    for (let i = week.length - 1; i >= 0; i--) {
      if (logs.data?.some((l) => l.habit_id === habitId && l.log_date === week[i])) count++;
      else break;
    }
    return count;
  }

  const chartData = month.map((day) => ({
    day: day.slice(5),
    completions: logs.data?.filter((l) => l.log_date === day).length ?? 0,
  }));

  return (
    <Page eyebrow="Routine" title="Habits" intro={description} wide>
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) add.mutate();
        }}
      >
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New habit"
          className="max-w-xs"
        />
        <Button type="submit" className="gap-2" disabled={add.isPending}>
          <Plus className="size-4" /> Add
        </Button>
      </form>

      {habits.data?.length ? (
        <div className="panel mt-6 p-5">
          <p className="label-mono">30-day completions</p>
          <div className="mt-3 h-40">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="habitFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.45} />
                    <stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  stroke="var(--color-border)"
                  strokeDasharray="3 3"
                  vertical={false}
                />
                <XAxis
                  dataKey="day"
                  tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }}
                  interval={4}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 10, fill: "var(--color-muted-foreground)" }}
                  width={24}
                />
                <Tooltip
                  contentStyle={{
                    background: "var(--color-surface-2)",
                    border: "1px solid var(--color-border)",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="completions"
                  stroke="var(--color-primary)"
                  fill="url(#habitFill)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      ) : null}

      <div className="mt-8 space-y-3">
        {habits.isLoading ? <Empty>Loading…</Empty> : null}
        {habits.data?.length === 0 ? <Empty>No habits yet.</Empty> : null}
        {habits.data?.map((h) => (
          <div key={h.id} className="panel flex flex-wrap items-center justify-between gap-4 p-4">
            <div>
              {editingId === h.id ? (
                <Input
                  autoFocus
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onBlur={() => editValue.trim() && rename.mutate({ id: h.id, value: editValue })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && editValue.trim())
                      rename.mutate({ id: h.id, value: editValue });
                    if (e.key === "Escape") setEditingId(null);
                  }}
                  className="h-7 max-w-48 text-sm"
                />
              ) : (
                <button
                  className="flex items-center gap-1.5 text-sm font-semibold hover:text-primary"
                  onClick={() => {
                    setEditingId(h.id);
                    setEditValue(h.name);
                  }}
                >
                  {h.name}
                  <Pencil className="size-3 opacity-40" />
                </button>
              )}
              <p className="label-mono mt-1">{streak(h.id)} day streak</p>
            </div>
            <div className="flex items-center gap-1.5">
              {week.map((day) => {
                const done = logs.data?.some((l) => l.habit_id === h.id && l.log_date === day);
                return (
                  <button
                    key={day}
                    onClick={() => toggle.mutate({ habitId: h.id, day })}
                    aria-label={`Toggle ${h.name} on ${day}`}
                    className={`flex size-8 items-center justify-center rounded-md border text-[0.6rem] ${
                      done
                        ? "border-primary bg-primary/25 text-foreground"
                        : "border-border text-muted-foreground"
                    }`}
                  >
                    {done ? <Check className="size-3.5" /> : day.slice(8)}
                  </button>
                );
              })}
              <button
                onClick={() => archive.mutate(h.id)}
                aria-label={`Archive ${h.name}`}
                className="ml-2 text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="size-4" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </Page>
  );
}
