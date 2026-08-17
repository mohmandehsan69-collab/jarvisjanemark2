import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { CopyButton } from "./CopyButton";
import { CASE, buildTicket } from "@/lib/support-data";

export function TicketComposer() {
  const [email, setEmail] = useState("");
  const [plan, setPlan] = useState("");
  const [notes, setNotes] = useState("");

  const ticket = useMemo(() => buildTicket(email, plan, notes), [email, plan, notes]);
  const mailto = `mailto:${CASE.supportEmail}?subject=${encodeURIComponent(
    `403 account_blocked on all write actions — ${CASE.projectName}`,
  )}&body=${encodeURIComponent(ticket.split("\n").slice(2).join("\n").trim())}`;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="ticket-email">Account email</Label>
          <Input
            id="ticket-email"
            type="email"
            inputMode="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="ticket-plan">Plan</Label>
          <Input
            id="ticket-plan"
            placeholder="Pro, Teams, Free…"
            value={plan}
            onChange={(e) => setPlan(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="ticket-notes">Extra context (optional)</Label>
          <Textarea
            id="ticket-notes"
            rows={5}
            placeholder="When it started, what you were doing, anything already tried."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <CopyButton value={ticket} label="Copy ticket" />
          <Button asChild size="sm" className="font-mono text-xs">
            <a href={mailto}>Open in email client</a>
          </Button>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Nothing here is stored or sent anywhere — the draft is assembled in your browser.
        </p>
      </div>

      <pre className="max-h-[30rem] overflow-auto rounded-lg border border-border bg-background/70 p-5 font-mono text-[0.78rem] leading-relaxed whitespace-pre-wrap text-foreground/90">
        {ticket}
      </pre>
    </div>
  );
}