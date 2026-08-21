import { AlertTriangle, Check, Sparkles } from "lucide-react";

export type CrossCheck = {
  combined: string;
  agreements: string[];
  disagreements: { topic: string; a: string; b: string }[];
  onlyInA: string[];
  onlyInB: string[];
  providerA: string;
  providerB: string;
  sources: { title: string; url: string }[];
};

/** Spec §3.3: never hide a disagreement behind one confident answer — always
 *  show what both passes agreed on, what conflicted, and what was unique. */
export function CrossCheckView({ result }: { result: CrossCheck }) {
  return (
    <div className="space-y-5">
      <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
        {result.combined}
      </p>

      {result.disagreements.length ? (
        <div className="rounded-lg border border-warn/40 bg-warn/10 p-4">
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-warn">
            <AlertTriangle className="size-3.5" /> Disagreement between passes
          </p>
          <ul className="mt-3 space-y-3">
            {result.disagreements.map((d, i) => (
              <li key={i} className="text-sm">
                <p className="font-semibold">{d.topic}</p>
                <p className="mt-1 text-muted-foreground">
                  <span className="font-mono text-[0.65rem] text-primary">{result.providerA}</span>:{" "}
                  {d.a}
                </p>
                <p className="mt-1 text-muted-foreground">
                  <span className="font-mono text-[0.65rem] text-primary">{result.providerB}</span>:{" "}
                  {d.b}
                </p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {result.agreements.length ? (
        <div>
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-ok">
            <Check className="size-3.5" /> Both passes agree
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            {result.agreements.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {result.onlyInA.length || result.onlyInB.length ? (
        <div>
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <Sparkles className="size-3.5" /> Only found by one pass
          </p>
          <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
            {result.onlyInA.map((a, i) => (
              <li key={`a${i}`}>
                <span className="font-mono text-[0.65rem] text-primary">{result.providerA}</span>:{" "}
                {a}
              </li>
            ))}
            {result.onlyInB.map((b, i) => (
              <li key={`b${i}`}>
                <span className="font-mono text-[0.65rem] text-primary">{result.providerB}</span>:{" "}
                {b}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {result.sources.length ? (
        <ul className="flex flex-wrap gap-x-4 gap-y-1">
          {result.sources.slice(0, 10).map((s, i) => (
            <li key={i}>
              <a
                href={s.url}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-[0.7rem] text-primary underline-offset-4 hover:underline"
              >
                {s.title || s.url}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
