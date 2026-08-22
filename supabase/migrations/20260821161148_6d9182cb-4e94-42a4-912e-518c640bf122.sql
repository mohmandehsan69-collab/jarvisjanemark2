-- Rebuild from spec: drop features that don't belong to Jarvis (leftovers from
-- unrelated prompts against the same Lovable Cloud project) and add the tables
-- the current spec actually needs.

DROP TABLE IF EXISTS public.trip_items CASCADE;
DROP TABLE IF EXISTS public.trips CASCADE;
DROP TABLE IF EXISTS public.workout_logs CASCADE;
DROP TABLE IF EXISTS public.workouts CASCADE;
DROP TABLE IF EXISTS public.product_radar CASCADE;
DROP TABLE IF EXISTS public.briefings CASCADE;
DROP TABLE IF EXISTS public.project_tasks CASCADE;
DROP TABLE IF EXISTS public.flashcards CASCADE;
DROP TABLE IF EXISTS public.training_progress CASCADE;

ALTER TABLE public.user_settings
  DROP COLUMN IF EXISTS prayer_method,
  DROP COLUMN IF EXISTS latitude,
  DROP COLUMN IF EXISTS longitude,
  DROP COLUMN IF EXISTS ai_provider,
  DROP COLUMN IF EXISTS voice_enabled;

ALTER TABLE public.user_settings
  ADD COLUMN IF NOT EXISTS preferred_language TEXT NOT NULL DEFAULT 'en'
    CHECK (preferred_language IN ('en', 'fa'));

-- 2.3 3D Studio: no persistence required by spec (client keeps the working
-- scene in memory; refine/export happen client-side). Nothing to add here.

-- 2.8 Deduction Training
CREATE TABLE public.deduction_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  drill_type TEXT NOT NULL CHECK (drill_type IN ('scenario', 'observation', 'memory_palace', 'cold_reading')),
  difficulty INTEGER NOT NULL DEFAULT 1,
  prompt TEXT NOT NULL,
  answer_key TEXT,
  response TEXT,
  reasoning_score INTEGER,
  accuracy_score INTEGER,
  feedback TEXT,
  recall_due TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX deduction_attempts_user_created ON public.deduction_attempts (user_id, created_at);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.deduction_attempts TO authenticated;
GRANT ALL ON public.deduction_attempts TO service_role;
ALTER TABLE public.deduction_attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own deduction attempts" ON public.deduction_attempts FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- 2.9 Metacognition Training
CREATE TABLE public.metacognition_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  drill_type TEXT NOT NULL CHECK (drill_type IN ('prediction', 'reasoning_trace', 'change_my_mind')),
  prompt TEXT NOT NULL,
  confidence_pct INTEGER NOT NULL CHECK (confidence_pct BETWEEN 0 AND 100),
  response TEXT,
  correct BOOLEAN,
  score INTEGER,
  biases_identified JSONB NOT NULL DEFAULT '[]'::jsonb,
  feedback TEXT,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX metacognition_attempts_user_created ON public.metacognition_attempts (user_id, created_at);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.metacognition_attempts TO authenticated;
GRANT ALL ON public.metacognition_attempts TO service_role;
ALTER TABLE public.metacognition_attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own metacognition attempts" ON public.metacognition_attempts FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- 2.10 Image Generation
CREATE TABLE public.generated_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  prompt TEXT NOT NULL,
  image_data TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT 'image/png',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX generated_images_user_created ON public.generated_images (user_id, created_at);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.generated_images TO authenticated;
GRANT ALL ON public.generated_images TO service_role;
ALTER TABLE public.generated_images ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own generated images" ON public.generated_images FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- 3.3 Multi-model cross-check: persist the agree/disagree breakdown alongside
-- research reports so a saved report keeps its confidence markers.
ALTER TABLE public.research_reports ADD COLUMN IF NOT EXISTS cross_check JSONB;
