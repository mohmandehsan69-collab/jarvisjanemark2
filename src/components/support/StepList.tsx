import { Check } from "lucide-react";
import type { Step } from "@/lib/support-data";
import { cn } from "@/lib/utils";

export function StepList({
  steps,
  done,
  onToggle,
  numbered = false,
}: {
  steps: Step[];
  done: Record<string, boolean>;
  onToggle: (id: string) => void;
  numbered?: boolean;
}) {
  return (
    <ol className="space-y-2">
      {steps.map((step, i) => {
        const isDone = !!done[step.id];
        return (
          <li key={step.id}>
            <button
              type="button"
              aria-pressed={isDone}
              onClick={() => onToggle(step.id)}
              className={cn(
                "group flex w-full items-start gap-4 rounded-lg border border-border bg-surface-2/60 p-4 text-left transition-all",
                "hover:border-signal/60 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                isDone && "border-ok/40 bg-surface-2/30",
              )}
            >
              <span
                className={cn(
                  "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md border border-border font-mono text-[11px] transition-colors",
                  isDone ? "border-ok/60 bg-ok/15 text-ok" : "text-muted-foreground",
                )}
              >
                {isDone ? <Check className="size-3.5" /> : numbered ? i + 1 : "·"}
              </span>
              <span className="space-y-1">
                <span
                  className={cn(
                    "block text-sm font-medium leading-snug",
                    isDone && "text-muted-foreground line-through decoration-ok/50",
                  )}
                >
                  {step.title}
                </span>
                <span className="block text-sm leading-relaxed text-muted-foreground">
                  {step.detail}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}