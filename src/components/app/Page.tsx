import type { ReactNode } from "react";

export function Page({
  eyebrow,
  title,
  intro,
  actions,
  children,
  wide,
}: {
  eyebrow: string;
  title: string;
  intro?: string;
  actions?: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <main className="grid-lines min-h-screen">
      <div
        className={`mx-auto w-full px-5 py-10 sm:px-8 sm:py-14 ${wide ? "max-w-6xl" : "max-w-4xl"}`}
      >
        <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="label-mono">{eyebrow}</p>
            <h1 className="mt-1.5 text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
            {intro ? (
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                {intro}
              </p>
            ) : null}
          </div>
          {actions}
        </header>
        {children}
      </div>
    </main>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
      {children}
    </p>
  );
}

export function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
