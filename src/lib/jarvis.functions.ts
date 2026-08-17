import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  gradeDrill,
  generateFlashcards,
  getProviderStatus,
  runChat,
  runDrill,
  runEngineering,
  runResearch,
  runTrends,
  runBriefing,
  suggestPacking,
} from "./jarvis.server";

export const aiStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => getProviderStatus(context.supabase as any, context.userId));

export const jarvisChat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ message: z.string().min(1).max(6000) }).parse(d))
  .handler(async ({ data, context }) =>
    runChat(context.supabase as any, context.userId, data.message),
  );

export const scanTrends = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ keyword: z.string().min(2).max(120) }).parse(d))
  .handler(async ({ data, context }) =>
    runTrends(context.supabase as any, context.userId, data.keyword),
  );

export const askEngineering = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ question: z.string().min(4).max(6000) }).parse(d))
  .handler(async ({ data, context }) =>
    runEngineering(context.supabase as any, context.userId, data.question),
  );

export const researchTopic = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        topic: z.string().min(3).max(400),
        outputType: z.enum(["summary", "spec", "comparison", "draft"]),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) =>
    runResearch(context.supabase as any, context.userId, data.topic, data.outputType),
  );

export const newDrill = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ drillType: z.enum(["deduction", "observation", "memory_palace"]) }).parse(d),
  )
  .handler(async ({ data, context }) =>
    runDrill(context.supabase as any, context.userId, data.drillType),
  );

export const submitDrill = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ drillId: z.string().uuid(), response: z.string().min(1).max(4000) }).parse(d),
  )
  .handler(async ({ data, context }) =>
    gradeDrill(context.supabase as any, context.userId, data.drillId, data.response),
  );

export const makeFlashcards = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        topic: z.string().min(2).max(200),
        deck: z.string().min(1).max(60),
        count: z.number().int().min(3).max(20),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) =>
    generateFlashcards(context.supabase as any, context.userId, data.topic, data.deck, data.count),
  );

export const morningBriefing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => runBriefing(context.supabase as any, context.userId));

export const packingSuggestions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ tripId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) =>
    suggestPacking(context.supabase as any, context.userId, data.tripId),
  );