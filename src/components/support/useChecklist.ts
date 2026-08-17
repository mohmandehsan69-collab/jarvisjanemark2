import { useCallback, useEffect, useState } from "react";

const KEY = "lovable-unblock-progress-v1";

export function useChecklist() {
  const [done, setDone] = useState<Record<string, boolean>>({});
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(KEY);
      if (raw) setDone(JSON.parse(raw) as Record<string, boolean>);
    } catch {
      // ignore corrupt state
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(KEY, JSON.stringify(done));
    } catch {
      // storage unavailable (private mode quota) — progress stays in memory
    }
  }, [done, hydrated]);

  const toggle = useCallback((id: string) => {
    setDone((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const reset = useCallback(() => setDone({}), []);

  return { done: hydrated ? done : {}, toggle, reset, hydrated };
}