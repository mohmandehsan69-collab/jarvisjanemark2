import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { buildChatSystem, loadChatHistory } from "@/lib/jarvis.server";
import { streamGeminiVoice } from "@/lib/ai.server";

// Raw server route (not a serverFn): needed so the browser can consume a true
// SSE stream and start speaking the first sentence while Gemini is still
// generating the rest (spec §2.2). createServerFn RPCs return one JSON blob;
// only a raw Response with a streaming body gets this.

function isNewSupabaseApiKey(value: string): boolean {
  return value.startsWith("sb_publishable_") || value.startsWith("sb_secret_");
}

async function authenticate(request: Request): Promise<{ supabase: any; userId: string }> {
  const SUPABASE_URL = process.env["SUPABASE_URL"];
  const SUPABASE_PUBLISHABLE_KEY = process.env["SUPABASE_PUBLISHABLE_KEY"];
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    throw new Error("Missing Supabase environment variables. Connect Supabase in Lovable Cloud.");
  }
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) throw new Error("Unauthorized: no bearer token provided");
  const token = authHeader.replace("Bearer ", "");
  if (token.split(".").length !== 3) throw new Error("Unauthorized: invalid token");

  const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    global: {
      fetch: (input, init) => {
        const headers = new Headers(init?.headers);
        if (
          isNewSupabaseApiKey(SUPABASE_PUBLISHABLE_KEY) &&
          headers.get("Authorization") === `Bearer ${SUPABASE_PUBLISHABLE_KEY}`
        ) {
          headers.delete("Authorization");
        }
        headers.set("apikey", SUPABASE_PUBLISHABLE_KEY);
        headers.set("Authorization", `Bearer ${token}`);
        return fetch(input, { ...init, headers });
      },
    },
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase.auth.getClaims(token);
  if (error || !data?.claims?.sub) throw new Error("Unauthorized: invalid token");
  return { supabase, userId: data.claims.sub as string };
}

export const Route = createFileRoute("/api/voice")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const { supabase, userId } = await authenticate(request);
          const body = (await request.json()) as { message?: string; language?: string };
          const message = String(body.message ?? "").slice(0, 6000);
          if (!message.trim()) return Response.json({ error: "Empty message." }, { status: 400 });

          const system = await buildChatSystem(supabase, userId, body.language);
          const history = await loadChatHistory(supabase, userId);
          const { response, model } = await streamGeminiVoice(system, [
            ...history,
            { role: "user", content: message },
          ]);

          return new Response(response.body, {
            status: 200,
            headers: {
              "content-type": "text/event-stream",
              "cache-control": "no-store",
              "x-jarvis-model": model,
            },
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const status = /unauthorized/i.test(message) ? 401 : 500;
          return Response.json({ error: message }, { status });
        }
      },
    },
  },
});
