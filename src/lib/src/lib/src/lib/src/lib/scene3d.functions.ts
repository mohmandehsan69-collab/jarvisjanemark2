import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { generateScene } from "./scene3d.server";

export const buildScene = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        prompt: z.string().min(2).max(1200),
        /** Passed back in when refining an existing model. */
        previous: z.any().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) =>
    generateScene(
      context.supabase as any,
      context.userId,
      data.prompt,
      (data.previous as any) ?? null,
    ),
  );
