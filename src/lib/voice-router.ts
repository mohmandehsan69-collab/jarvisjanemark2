import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
import { routeIntent } from "@/lib/jarvis.functions";

/** Spec §3.1/§3.2: a voice request must navigate to the right tab AND run
 *  there on arrival — not just switch pages. Since the destination route may
 *  not be mounted yet, the instruction is handed off via sessionStorage
 *  rather than router state, and each destination page consumes it once. */
const PENDING_KEY = "jarvis:pending-voice-instruction";

export function setPendingInstruction(instruction: string) {
  try {
    sessionStorage.setItem(PENDING_KEY, instruction);
  } catch {
    /* sessionStorage unavailable (private mode, SSR) — voice just won't auto-run. */
  }
}

/** Call once on mount of a page that can act on a routed voice instruction. */
export function consumePendingInstruction(): string | null {
  try {
    const value = sessionStorage.getItem(PENDING_KEY);
    if (value) sessionStorage.removeItem(PENDING_KEY);
    return value;
  } catch {
    return null;
  }
}

const INTENT_ROUTES: Record<string, string> = {
  model3d: "/studio",
  engineering: "/engineering",
  research: "/research",
  trends: "/trends",
  image: "/images",
  habits: "/habits",
  deduction: "/deduction",
  metacognition: "/metacognition",
};

/** Returns a function suitable as `useVoiceMode({ onRoute })`: classifies the
 *  utterance and, if it belongs on another tab, navigates there with the
 *  instruction queued for auto-run. Returns false for plain chat so the
 *  caller answers inline instead. */
export function useVoiceRouter() {
  const classify = useServerFn(routeIntent);
  const navigate = useNavigate();

  return async (text: string): Promise<boolean> => {
    const { intent, instruction } = await classify({ data: { message: text } });
    const path = INTENT_ROUTES[intent];
    if (!path) return false;
    setPendingInstruction(instruction);
    void navigate({ to: path as "/" });
    return true;
  };
}
