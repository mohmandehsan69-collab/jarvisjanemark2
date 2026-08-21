import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  analyzeScreen,
  buildChatSystem,
  classifyIntent,
  createImage,
  gradeDeductionDrill,
  getMetacognitionStats,
  getProviderStatus,
  loadChatHistory,
  newDeductionDrill,
  newMetacognitionDrill,
  persistVoiceTurn,
  promoteReportToProject,
  runChat,
  runEngineering,
  runResearch,
  runTrends,
  speak,
  submitMetacognitionDrill,
} from "./jarvis.server";

export const aiStatus = createServerFn({ method: "GET" }).handler(async () => getProviderStatus());

export const jarvisChat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        message: z.string().min(1).max(6000),
        voice: z.boolean().optional(),
        language: z.string().max(120).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) =>
    runChat(
      context.supabase as any,
      context.userId,
      data.message,
      data.voice ?? false,
      data.language,
    ),
  );

/** Voice mode calls the raw streaming route (src/routes/api/voice.ts) to
 *  generate the reply, then this to persist the turn + extract memory. */
export const persistVoiceReply = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ message: z.string().min(1).max(6000), reply: z.string().min(1).max(4000) }).parse(d),
  )
  .handler(async ({ data, context }) =>
    persistVoiceTurn(context.supabase as any, context.userId, data.message, data.reply),
  );

/** Used by the streaming voice route to build the same system prompt + history
 *  the non-streaming chat path uses, so voice replies stay consistent. */
export const voiceContext = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ language: z.string().max(120).optional() }).parse(d))
  .handler(async ({ data, context }) => ({
    system: await buildChatSystem(context.supabase as any, context.userId, data.language),
    history: await loadChatHistory(context.supabase as any, context.userId),
  }));

export const speakText = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({ text: z.string().min(1).max(2000), languageHint: z.string().min(1).max(60) })
      .parse(d),
  )
  .handler(async ({ data }) => speak(data.text, data.languageHint));

export const routeIntent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ message: z.string().min(1).max(2000) }).parse(d))
  .handler(async ({ data }) => classifyIntent(data.message));

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

export const promoteReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ reportId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) =>
    promoteReportToProject(context.supabase as any, context.userId, data.reportId),
  );

export const newDrill = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({ drillType: z.enum(["scenario", "observation", "memory_palace", "cold_reading"]) })
      .parse(d),
  )
  .handler(async ({ data, context }) =>
    newDeductionDrill(context.supabase as any, context.userId, data.drillType),
  );

export const submitDrill = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ drillId: z.string().uuid(), response: z.string().min(1).max(4000) }).parse(d),
  )
  .handler(async ({ data, context }) =>
    gradeDeductionDrill(context.supabase as any, context.userId, data.drillId, data.response),
  );

export const newMetacognition = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ drillType: z.enum(["prediction", "reasoning_trace", "change_my_mind"]) }).parse(d),
  )
  .handler(async ({ data, context }) =>
    newMetacognitionDrill(context.supabase as any, context.userId, data.drillType),
  );

export const submitMetacognition = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        attemptId: z.string().uuid(),
        confidencePct: z.number().int().min(0).max(100),
        response: z.string().min(1).max(4000),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) =>
    submitMetacognitionDrill(
      context.supabase as any,
      context.userId,
      data.attemptId,
      data.confidencePct,
      data.response,
    ),
  );

export const metacognitionStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => getMetacognitionStats(context.supabase as any, context.userId));

export const generateImage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ prompt: z.string().min(2).max(1000) }).parse(d))
  .handler(async ({ data, context }) =>
    createImage(context.supabase as any, context.userId, data.prompt),
  );

export const shareScreen = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        base64: z.string().min(1),
        mimeType: z.string().min(1).max(60),
        question: z.string().max(2000).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }) =>
    analyzeScreen({ base64: data.base64, mimeType: data.mimeType }, data.question ?? ""),
  );
