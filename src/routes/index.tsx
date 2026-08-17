import { createFileRoute } from "@tanstack/react-router";
import {
  AlertTriangle,
  ExternalLink,
  RotateCcw,
  ShieldAlert,
  Terminal,
  Wrench,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/support/CopyButton";
import { StepList } from "@/components/support/StepList";
import { TicketComposer } from "@/components/support/TicketComposer";
import { useChecklist } from "@/components/support/useChecklist";
import { CASE, corrections, preflight, reconnectSteps } from "@/lib/support-data";

const title = "Account Unblock Runbook — 403 account_blocked";
const description =
  "An interactive runbook for a Lovable account returning 403 account_blocked: preflight checks, a connector re-authorization sequence that actually switches accounts, and a ready-to-send support ticket.";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Runbook,
});

function Section({
  index,
  eyebrow,
  heading,
  icon,
  children,
  aside,
}: {
  index: string;
  eyebrow: string;
  heading: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  aside?: React.ReactNode;
}) {
  return (
    <section className="panel p-6 sm:p-8">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <span className="mt-1 flex size-9 items-center justify-center rounded-md border border-signal/40 bg-signal/10 text-signal">
            {icon}
          </span>
          <div>
            <p className="label-mono">
              {index} — {eyebrow}
            </p>
            <h2 className="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">{heading}</h2>
          </div>
        </div>
        {aside}
      </header>
      {children}
    </section>
  );
}

function Runbook() {
  const { done, toggle, reset } = useChecklist();
  const allSteps = [...preflight, ...reconnectSteps];
  const completed = allSteps.filter((s) => done[s.id]).length;
  const pct = Math.round((completed / allSteps.length) * 100);

  return (
    <main className="grid-lines min-h-screen">
      <div className="mx-auto w-full max-w-5xl px-5 py-14 sm:px-8 sm:py-20">
        <header className="mb-12">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="border-destructive/50 font-mono text-destructive">
              HTTP 403
            </Badge>
            <Badge variant="outline" className="font-mono text-muted-foreground">
              writes blocked · reads OK
            </Badge>
          </div>
          <h1 className="mt-5 text-4xl font-semibold leading-[1.05] tracking-tight sm:text-6xl">
            Account unblock
            <span className="block text-signal">runbook</span>
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
            A working sequence for an account returning{" "}
            <code className="font-mono text-foreground">account_blocked</code> on every write, and a
            connector re-authorization that genuinely switches identities. Errors from the original
            notes are corrected in section 03.
          </p>

          <div className="mt-8 panel bg-surface/60 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="label-mono">
                Progress · {completed}/{allSteps.length} steps
              </p>
              <Button
                variant="ghost"
                size="sm"
                onClick={reset}
                className="gap-2 font-mono text-xs text-muted-foreground"
              >
                <RotateCcw className="size-3.5" /> Reset
              </Button>
            </div>
            <Progress value={pct} className="mt-3 h-2" />
          </div>
        </header>

        <div className="space-y-8">
          <Section
            index="00"
            eyebrow="Evidence"
            heading="The exact error"
            icon={<Terminal className="size-4" />}
            aside={<CopyButton value={CASE.errorText} label="Copy error" />}
          >
            <pre className="overflow-auto rounded-lg border border-destructive/30 bg-destructive/5 p-5 font-mono text-[0.8rem] leading-relaxed whitespace-pre-wrap text-foreground/90">
              {CASE.errorText}
            </pre>
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
              Reads succeeding while writes fail is the signature of a permissions downgrade on the
              account, not an outage. Retrying the same call will keep returning 403 — diagnose the
              cause, then escalate.
            </p>
          </Section>

          <Section
            index="01"
            eyebrow="Preflight"
            heading="Rule out the causes you control"
            icon={<ShieldAlert className="size-4" />}
          >
            <StepList steps={preflight} done={done} onToggle={toggle} />
          </Section>

          <Section
            index="02"
            eyebrow="Connector"
            heading="Force a real account switch"
            icon={<RotateCcw className="size-4" />}
          >
            <p className="mb-5 text-sm leading-relaxed text-muted-foreground">
              Disconnect-and-reconnect alone re-approves the existing grant, which is why the old
              account kept coming back. Revoke the authorization server-side first, then remove every
              cached session, in this order.
            </p>
            <StepList steps={reconnectSteps} done={done} onToggle={toggle} numbered />
          </Section>

          <Section
            index="03"
            eyebrow="Corrections"
            heading="Mistakes in the original notes"
            icon={<AlertTriangle className="size-4" />}
          >
            <ul className="grid gap-4 sm:grid-cols-2">
              {corrections.map((c) => (
                <li key={c.id} className="rounded-lg border border-warn/30 bg-warn/[0.06] p-5">
                  <p className="label-mono text-warn">{c.label}</p>
                  <h3 className="mt-2 text-sm font-semibold leading-snug">{c.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{c.body}</p>
                </li>
              ))}
            </ul>
          </Section>

          <Section
            index="04"
            eyebrow="Escalation"
            heading="Support ticket generator"
            icon={<Wrench className="size-4" />}
          >
            <TicketComposer />
          </Section>

          <Section
            index="05"
            eyebrow="Reference"
            heading="Case identifiers"
            icon={<ExternalLink className="size-4" />}
          >
            <dl className="grid gap-3 sm:grid-cols-2">
              {[
                { k: "Support", v: CASE.supportEmail },
                { k: "Project", v: CASE.projectName },
                { k: "Project ID", v: CASE.projectId },
                { k: "Workspace ID", v: CASE.workspaceId },
                { k: "Editor URL", v: CASE.editorUrl },
                { k: "Live app", v: CASE.liveUrl },
              ].map((row) => (
                <div
                  key={row.k}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-2/60 px-4 py-3"
                >
                  <div className="min-w-0">
                    <dt className="label-mono">{row.k}</dt>
                    <dd className="truncate font-mono text-xs text-foreground/90">{row.v}</dd>
                  </div>
                  <CopyButton value={row.v} label="Copy" className="shrink-0" />
                </div>
              ))}
            </dl>
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
              Safe to paste into a ticket. Never include API keys, bearer tokens, or session cookies
              — rotate any that have already been shared.
            </p>
          </Section>
        </div>

        <footer className="mt-12 border-t border-border pt-6 text-xs leading-relaxed text-muted-foreground">
          Progress is saved locally in this browser only.
        </footer>
      </div>
    </main>
  );
}