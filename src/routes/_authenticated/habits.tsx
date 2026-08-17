import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Check, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Page, Empty, errorText } from "@/components/app/Page";
import { supabase } from "@/integrations/supabase/client";

const title = "Habit tracker";
const description =
  "Track daily habits with streaks: tap a day to log it, and Jarvis can reference your habits in chat and briefings.";

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

const days = Array.from({ length: 7 }, (_, i) => {
  const d = new Date();
  d.setDate(d.getDate() - (6 - i));
  return d.toISOString().slice(0, 10);
});

function HabitsPage() {
  const [name, setName] = useState("");
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
        .gte("log_date", days[0]!);
      if (error) throw new Error(error.message);
      return data;
    },
  });

  const add = useMutation({
    mutationFn: async () => {
      const userId = (await supabase.auth.getUser()).data.user!.id;
      const { error } = await supabase.from("habits").insert({ user_id: userId, name: name.trim() });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      setName("");
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
    for (let i = days.length - 1; i >= 0; i--) {
      if (logs.data?.some((l) => l.habit_id === habitId && l.log_date === days[i])) count++;
      else break;
    }
    return count;
  }

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

      <div className="mt-8 space-y-3">
        {habits.isLoading ? <Empty>Loading…</Empty> : null}
        {habits.data?.length === 0 ? <Empty>No habits yet.</Empty> : null}
        {habits.data?.map((h) => (
          <div key={h.id} className="panel flex flex-wrap items-center justify-between gap-4 p-4">
            <div>
              <p className="text-sm font-semibold">{h.name}</p>
              <p className="label-mono mt-1">{streak(h.id)} day streak</p>
            </div>
            <div className="flex items-center gap-1.5">
              {days.map((day) => {
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
