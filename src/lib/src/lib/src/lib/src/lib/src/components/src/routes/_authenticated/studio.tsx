import { createFileRoute, Link, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { Activity, Box, Compass, LogOut, MessageSquare, Mic, Radar, Sparkles, Wrench } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated")({
  component: Shell,
});

const nav = [
  { to: "/chat", label: "Chat", icon: MessageSquare },
  { to: "/face", label: "Face", icon: Mic },
  { to: "/briefing", label: "Briefing", icon: Sparkles },
  { to: "/trends", label: "Trends", icon: Radar },
  { to: "/research", label: "Research", icon: Compass },
  { to: "/engineering", label: "Engineering", icon: Wrench },
  { to: "/studio", label: "3D Studio", icon: Box },
  { to: "/habits", label: "Habits", icon: Activity },
] as const;

function Shell() {
  const { session, loading, signOut } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !session) navigate({ to: "/auth", replace: true });
  }, [loading, session, navigate]);

  if (loading || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="label-mono">Checking session…</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col border-r border-border bg-sidebar px-3 py-5 lg:flex">
        <p className="px-2 text-lg font-semibold tracking-tight">
          Jarvis<span className="text-primary">.</span>
        </p>
        <nav className="mt-6 flex-1 space-y-0.5 overflow-y-auto">
          {nav.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
              activeProps={{ className: "bg-primary/15 text-foreground" }}
            >
              <item.icon className="size-4" />
              {item.label}
            </Link>
          ))}
        </nav>
        <button
          onClick={() => signOut()}
          className="mt-3 flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <LogOut className="size-4" /> Sign out
        </button>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="min-w-0 flex-1 pb-20 lg:pb-0">
          <Outlet />
        </div>
        <nav
          className={cn(
            "fixed inset-x-0 bottom-0 z-20 flex gap-1 overflow-x-auto border-t border-border bg-sidebar/95 px-2 py-2 backdrop-blur lg:hidden",
          )}
        >
          {nav.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className="flex min-w-16 flex-col items-center gap-1 rounded-md px-2 py-1.5 text-[0.65rem] text-muted-foreground"
              activeProps={{ className: "bg-primary/15 text-foreground" }}
            >
              <item.icon className="size-4" />
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
    </div>
  );
}
