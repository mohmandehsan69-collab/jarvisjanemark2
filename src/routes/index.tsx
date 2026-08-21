import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { Box, Brain, Compass, Eye, Image as ImageIcon, Mic, Radar, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";

const title = "Jarvis — your personal AI assistant";
const description =
  "Jarvis is a private AI assistant with long-term memory, hands-free ambient voice mode, a 3D modelling studio, grounded engineering and research, and deduction and calibration training.";

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
  {
    icon: Mic,
    name: "Ambient face mode",
    body: "Hands-free listen → think → speak loop, with a holographic radar visual and true barge-in interruption.",
  },
  {
    icon: Box,
    name: "3D Studio",
    body: "Describe a building or object and Jarvis composes a real 3D model with correct real-world scale, live in the browser.",
  },
  {
    icon: Wrench,
    name: "Engineering Q&A",
    body: "Grounded mechanical, electrical, civil and structural answers that cite the standard they relied on.",
  },
  {
    icon: Compass,
    name: "Multi-source research",
    body: "Cross-checked research and reports you can promote into tracked projects.",
  },
  {
    icon: Eye,
    name: "Deduction training",
    body: "Scenario, observation, memory-palace and cold-reading drills, graded on reasoning — not just the answer.",
  },
  {
    icon: Brain,
    name: "Metacognition training",
    body: "Confidence-calibration drills with a running Brier score and a plain-language bias summary.",
  },
  {
    icon: Radar,
    name: "Trends",
    body: "Grounded scans of what's rising or falling in any niche, with sources.",
  },
  {
    icon: ImageIcon,
    name: "Image generation",
    body: "Describe an image and Jarvis renders it, saved to a private gallery.",
  },
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
          <span className="block text-primary">remembers, builds, reasons.</span>
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
