import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { Activity, Brain, Compass, Mic, Radar, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";

const title = "Jarvis — your personal AI assistant";
const description =
  "Jarvis is a private AI assistant with long-term memory, hands-free voice mode, grounded trend and research briefings, habit and workout tracking, and engineering Q&A.";

export const Route = createFileRoute("/")({
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
  component: Landing,
});

const features = [
  { icon: Sparkles, name: "Chat with memory", body: "Durable facts are stored separately from chat logs and injected every message." },
  { icon: Mic, name: "Ambient face mode", body: "Hands-free listen → think → speak loop using the browser's own speech APIs." },
  { icon: Radar, name: "Trends", body: "Grounded scans of what is rising or falling in any niche, with sources." },
  { icon: Compass, name: "Research & projects", body: "Cross-checked briefings, specs and comparisons you can promote into projects." },
  { icon: Activity, name: "Habits, workouts, trips", body: "Streaks, a calisthenics rotation logger, packing lists and a product radar." },
  { icon: Brain, name: "Training & flashcards", body: "Deduction and observation drills, graded, plus spaced-repetition decks." },
];

function Landing() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && session) navigate({ to: "/chat", replace: true });
  }, [loading, session, navigate]);

  return (
    <main className="grid-lines min-h-screen">
      <div className="mx-auto w-full max-w-5xl px-5 py-16 sm:px-8 sm:py-24">
        <p className="label-mono">Personal assistant · private by default</p>
        <h1 className="mt-5 text-5xl font-semibold leading-[1.02] tracking-tight sm:text-7xl">
          Jarvis
          <span className="block text-primary">remembers, researches, reports.</span>
        </h1>
        <p className="mt-6 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
          {description}
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Button asChild size="lg">
            <Link to="/auth">Sign in / create account</Link>
          </Button>
        </div>

        <ul className="mt-16 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <li key={f.name} className="panel p-5">
              <f.icon className="size-5 text-primary" />
              <h2 className="mt-3 text-sm font-semibold">{f.name}</h2>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{f.body}</p>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}