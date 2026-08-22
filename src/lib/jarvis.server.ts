import {
  callAI,
  extractJson,
  generateImage,
  providerStatus,
  runCrossCheck,
  synthesizeSpeech,
} from "./ai.server";

type Db = { from: (table: string) => any };

const VOICE =
  "You are Jarvis, a personal assistant modelled on a calm, precise lab-assistant AI. Tone: composed, exact, slightly formal — never theatrical, never sycophantic. Prefer concrete numbers, units and steps over hedging. If you are unsure, say what you would need to be sure.";

export function getProviderStatus() {
  return providerStatus();
}

async function loadMemoryBlock(supabase: Db, userId: string) {
  const { data: notes } = await supabase
    .from("memory_notes")
    .select("key,value")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(60);
  const { data: habits } = await supabase
    .from("habits")
    .select("id,name")
    .eq("user_id", userId)
    .eq("archived", false);
  const lines: string[] = [];
  for (const n of notes ?? []) lines.push(`- ${n.key}: ${n.value}`);
  if (habits?.length) lines.push(`- tracked habits: ${habits.map((h: any) => h.name).join(", ")}`);
  if (!lines.length) return "No stored facts yet.";
  return lines.join("\n");
}

/** Shared by the non-streaming chat path and the streaming voice path: save
 *  the turn and extract any durable new fact (spec §2.1 long-term memory). */
export async function persistChatTurn(
  supabase: Db,
  userId: string,
  message: string,
  rawReply: string,
  provider?: string,
) {
  let reply = rawReply;
  const match = reply.match(/^MEMORY:\s*(\{[\s\S]*\})\s*$/m);
  let savedMemory: { key: string; value: string } | null = null;
  if (match) {
    reply = reply.replace(match[0], "").trim();
    const parsed = extractJson<{ key?: string; value?: string }>(match[1]!);
    if (parsed?.key && parsed?.value) {
      savedMemory = {
        key: String(parsed.key).slice(0, 80),
        value: String(parsed.value).slice(0, 400),
      };
      await supabase
        .from("memory_notes")
        .upsert(
          { user_id: userId, key: savedMemory.key, value: savedMemory.value, source: "chat" },
          { onConflict: "user_id,key" },
        );
    }
  }

  const { error } = await supabase.from("chat_messages").insert([
    { user_id: userId, role: "user", content: message },
    { user_id: userId, role: "assistant", content: reply, provider: provider ?? null },
  ]);
  if (error) throw new Error(`Reply generated but could not be saved: ${error.message}`);

  return { reply, savedMemory };
}

const MEMORY_INSTRUCTION = `If this message reveals a durable new fact worth remembering (a routine, preference, goal, constraint, or identity detail — not small talk), end your reply with a final line exactly of the form:
MEMORY: {"key":"short_snake_case_key","value":"the fact in one short sentence"}
Emit at most one MEMORY line, and only when the fact is genuinely durable.`;

export async function buildChatSystem(supabase: Db, userId: string, language?: string) {
  const memory = await loadMemoryBlock(supabase, userId);
  const languageRule = language
    ? `\n\nLANGUAGE: Reply entirely in ${language}. Use natural, grammatical everyday phrasing a native speaker would use, not literal translation from English. Keep the same script throughout.`
    : "";
  return `${VOICE}${languageRule}

Known facts about the user (long-term memory):
${memory}

Use those facts naturally when relevant. Never invent facts about the user.
${MEMORY_INSTRUCTION}`;
}

export async function loadChatHistory(supabase: Db, userId: string) {
  const { data: history } = await supabase
    .from("chat_messages")
    .select("role,content")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(20);
  return [...(history ?? [])].reverse().map((m: any) => ({
    role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
    content: String(m.content),
  }));
}

export async function runChat(
  supabase: Db,
  userId: string,
  message: string,
  voice = false,
  language?: string,
) {
  const system = await buildChatSystem(supabase, userId, language);
  const history = await loadChatHistory(supabase, userId);
  const result = await callAI({
    system,
    messages: [...history, { role: "user", content: message }],
    voice,
  });
  const { reply, savedMemory } = await persistChatTurn(
    supabase,
    userId,
    message,
    result.text,
    result.provider,
  );
  return { reply, provider: result.provider, model: result.model, savedMemory };
}

/** Voice path calls this after streaming the reply client-side, to persist
 *  the turn without re-running generation. */
export async function persistVoiceTurn(
  supabase: Db,
  userId: string,
  message: string,
  reply: string,
) {
  return persistChatTurn(supabase, userId, message, reply, "gemini");
}

/** Spec §5.2: server TTS for languages with no local browser voice. */
export async function speak(text: string, languageHint: string) {
  return synthesizeSpeech(text, languageHint);
}

const INTENTS = [
  "model3d",
  "engineering",
  "research",
  "trends",
  "habits",
  "image",
  "deduction",
  "metacognition",
  "chat",
] as const;
export type Intent = (typeof INTENTS)[number];

/** Spec §3.1 / §3.2: classify a spoken/typed request so Face mode and the
 *  floating mic can route it to the right tab and run it on arrival. */
export async function classifyIntent(
  message: string,
): Promise<{ intent: Intent; instruction: string }> {
  const result = await callAI({
    json: true,
    voice: true,
    system:
      'Classify the user\'s request into exactly one label and extract the clean instruction to carry out. Labels: model3d (build/change a 3D model), engineering (mechanical/electrical/civil/structural/architectural question), research (multi-source research on a topic), trends (what\'s trending in a niche), habits (habit tracking), image (generate an image), deduction (deduction/observation training drill), metacognition (calibration/confidence training drill), chat (anything else, general conversation). Return ONLY JSON: {"intent": one of the labels, "instruction": the cleaned request text to run on that tab, or the original message for chat}.',
    messages: [{ role: "user", content: message }],
  });
  const parsed = extractJson<{ intent?: string; instruction?: string }>(result.text);
  const intent = INTENTS.includes(parsed?.intent as Intent) ? (parsed!.intent as Intent) : "chat";
  return { intent, instruction: String(parsed?.instruction ?? message) };
}

export type Trend = {
  topic: string;
  direction: "rising" | "falling" | "steady";
  reasoning: string;
  sources: string[];
};

export async function runTrends(supabase: Db, userId: string, keyword: string, source = "manual") {
  const result = await callAI({
    system: `${VOICE} You are a trend analyst. Research current public signals with the search tool before answering.`,
    search: true,
    messages: [
      {
        role: "user",
        content: `Identify 6 topics currently trending within "${keyword}". Respond with ONLY a JSON array, no prose, each item: {"topic": string, "direction": "rising" | "falling" | "steady", "reasoning": string (max 40 words, cite the signal), "sources": string[] (URLs)}.`,
      },
    ],
  });
  const parsed = extractJson<Trend[]>(result.text);
  if (!parsed || !Array.isArray(parsed) || !parsed.length) {
    throw new Error(
      `The model did not return usable trend JSON. Raw start of reply: ${result.text.slice(0, 200)}`,
    );
  }
  const trends = parsed.slice(0, 8).map((t) => ({
    topic: String(t.topic ?? "Untitled"),
    direction: (["rising", "falling", "steady"] as const).includes(t.direction as any)
      ? t.direction
      : ("steady" as const),
    reasoning: String(t.reasoning ?? ""),
    sources: Array.isArray(t.sources) ? t.sources.filter((s) => typeof s === "string") : [],
  }));
  const { data, error } = await supabase
    .from("trend_queries")
    .insert({ user_id: userId, keyword, results: trends, source })
    .select("id,keyword,results,created_at")
    .single();
  if (error) throw new Error(`Trends found but could not be saved: ${error.message}`);
  return { row: data, provider: result.provider };
}

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

/** Spec §3.3: reconcile two independent passes into an explicit agree /
 *  disagree / unique breakdown. Never silently prefers one answer. */
async function reconcile(
  a: { text: string; provider: string },
  b: { text: string; provider: string },
): Promise<Omit<CrossCheck, "sources">> {
  const result = await callAI({
    json: true,
    system: `${VOICE} You reconcile two independent expert answers to the same question. Be precise about what genuinely agrees vs conflicts — do not paper over real disagreements, and do not invent disagreement where there is none.`,
    messages: [
      {
        role: "user",
        content: `PASS A:\n${a.text}\n\nPASS B:\n${b.text}\n\nReturn ONLY JSON: {"combined": "a synthesized answer that flags disagreement inline rather than hiding it", "agreements": string[] (points both passes support), "disagreements": [{"topic": string, "a": "what pass A said", "b": "what pass B said"}], "onlyInA": string[], "onlyInB": string[]}`,
      },
    ],
  });
  const parsed = extractJson<Omit<CrossCheck, "sources" | "providerA" | "providerB">>(result.text);
  if (!parsed) {
    // Reconciliation itself never fails silently either — fall back to showing both raw.
    return {
      combined: `${a.text}\n\n---\n\nSecond pass:\n\n${b.text}`,
      agreements: [],
      disagreements: [],
      onlyInA: [],
      onlyInB: [],
      providerA: a.provider,
      providerB: b.provider,
    };
  }
  return { ...parsed, providerA: a.provider, providerB: b.provider };
}

export async function runEngineering(supabase: Db, userId: string, question: string) {
  const system = `${VOICE} You are a chartered engineer across mechanical, electrical, civil/structural and architectural engineering. Work step by step: restate the problem, list assumptions and given values with units, show each calculation line, then state the answer with units and a sanity check. Verify code clauses, material properties and standards against sources rather than memory, and name the standard/edition you relied on — state plainly when a value is version-dependent. Flag safety-critical items and state clearly when a licensed engineer must sign off.`;
  const { a, b } = await runCrossCheck({ system, question, search: true });
  const crossCheck = await reconcile(a, b);
  return { ...crossCheck, sources: [...a.sources, ...b.sources] };
}

export async function runResearch(supabase: Db, userId: string, topic: string, outputType: string) {
  const shape: Record<string, string> = {
    summary: "a structured briefing with key findings, open questions and next steps",
    spec: "a technical specification with scope, requirements (numbered), constraints and acceptance criteria",
    comparison:
      "a comparison document with a criteria table, per-option analysis and a recommendation",
    draft: "a polished draft document ready to send, with headings and a short executive summary",
  };
  const system = `${VOICE} You are a research analyst. Method: search broadly, re-query from a different angle to cross-check the main claims, including background sources. Mark any claim you could not corroborate as UNVERIFIED. Output markdown.`;
  const question = `Research: ${topic}\n\nProduce ${shape[outputType] ?? shape["summary"]}. Include a "Sources" section with URLs.`;
  const { a, b } = await runCrossCheck({ system, question, search: true });
  const crossCheck: CrossCheck = {
    ...(await reconcile(a, b)),
    sources: [...a.sources, ...b.sources],
  };

  const { data, error } = await supabase
    .from("research_reports")
    .insert({
      user_id: userId,
      topic,
      output_type: outputType,
      body: crossCheck.combined,
      sources: crossCheck.sources,
      cross_check: crossCheck,
    })
    .select("id,topic,output_type,body,sources,cross_check,created_at")
    .single();
  if (error) throw new Error(`Report generated but could not be saved: ${error.message}`);
  return { row: data, crossCheck };
}

export async function promoteReportToProject(supabase: Db, userId: string, reportId: string) {
  const { data: report, error: loadError } = await supabase
    .from("research_reports")
    .select("id,topic,body")
    .eq("id", reportId)
    .eq("user_id", userId)
    .single();
  if (loadError || !report) throw new Error("That report could not be found for this account.");
  const { data, error } = await supabase
    .from("projects")
    .insert({
      user_id: userId,
      title: report.topic,
      status: "idea",
      summary: String(report.body).slice(0, 500),
      source_report_id: report.id,
    })
    .select("id,title,status,summary,created_at")
    .single();
  if (error) throw new Error(`Could not create project: ${error.message}`);
  return { row: data };
}

// ---------------------------------------------------------------------------
// Deduction Training (§2.8)
// ---------------------------------------------------------------------------

const DEDUCTION_BRIEFS: Record<string, string> = {
  scenario:
    "Write a short scenario (max 130 words) describing a person, object arrangement, or situation in concrete physical detail (clothing, wear patterns, posture, small inconsistencies). Then ask: 'What can be deduced about what happened here, or about the person involved?' Do NOT reveal the answer in the prompt. Separately state the intended answer key: the specific deductions a trained observer would make and exactly which detail supports each one.",
  observation:
    "Write a dense 100-word scene description containing exactly 8 specific checkable details (colours, counts, positions, small objects). State that 3 recall questions will follow about it, but do NOT ask them yet and do NOT reveal answers — just the scene. Separately state the answer key: the 8 details and their values.",
  memory_palace:
    "Give a list of exactly 10 unrelated concrete items, each with a one-line vivid placement instruction for a memory-palace route (e.g. 'front door: a flaming trumpet'). State plainly that recall will be tested after a delay. Do NOT reveal any answer key in the prompt itself. Separately state the answer key: the ordered list of items.",
  cold_reading:
    "Describe a person's appearance, posture, speech pattern and behaviour in concrete detail (max 120 words), enough to support a few reasonable inferences about background, profession, or current state of mind — but keep it genuinely ambiguous, not a giveaway. Ask what can be inferred, and to mark each inference with its supporting evidence. Do NOT reveal the answer in the prompt. Separately state the answer key: which inferences are well-evidenced vs unfounded leaps for this description.",
};

function difficultyLabel(level: number) {
  if (level <= 1) return "beginner — obvious, generous detail";
  if (level === 2) return "easy — a little subtlety required";
  if (level === 3) return "moderate — realistic ambiguity";
  if (level === 4) return "hard — subtle, easy to over-read";
  return "expert — sparse detail, genuine ambiguity, red herrings allowed";
}

async function nextDifficulty(supabase: Db, userId: string, drillType: string): Promise<number> {
  const { data } = await supabase
    .from("deduction_attempts")
    .select("reasoning_score,accuracy_score")
    .eq("user_id", userId)
    .eq("drill_type", drillType)
    .not("completed_at", "is", null)
    .order("created_at", { ascending: false })
    .limit(5);
  const rows = (data ?? []) as { reasoning_score: number | null; accuracy_score: number | null }[];
  if (!rows.length) return 1;
  const avg =
    rows.reduce((sum, r) => sum + ((r.reasoning_score ?? 0) + (r.accuracy_score ?? 0)) / 2, 0) /
    rows.length;
  if (avg >= 85) return 5;
  if (avg >= 70) return 4;
  if (avg >= 55) return 3;
  if (avg >= 35) return 2;
  return 1;
}

export async function newDeductionDrill(supabase: Db, userId: string, drillType: string) {
  const difficulty = await nextDifficulty(supabase, userId, drillType);
  const result = await callAI({
    json: true,
    system: `${VOICE} You design cognitive observation and deduction drills in the style of a trained investigator's training programme. Be concrete and specific; avoid mysticism and avoid claiming cold reading is infallible. Difficulty: ${difficultyLabel(difficulty)}.`,
    messages: [
      {
        role: "user",
        content: `${DEDUCTION_BRIEFS[drillType] ?? DEDUCTION_BRIEFS["scenario"]!}\n\nReturn ONLY JSON: {"prompt": "the text shown to the trainee, with no answer in it", "answerKey": "the hidden answer key described above"}`,
      },
    ],
  });
  const parsed = extractJson<{ prompt?: string; answerKey?: string }>(result.text);
  if (!parsed?.prompt)
    throw new Error(`Drill generation returned unusable output: ${result.text.slice(0, 200)}`);
  const recallDue =
    drillType === "memory_palace" || drillType === "observation"
      ? new Date(Date.now() + 15 * 60_000).toISOString()
      : null;
  const { data, error } = await supabase
    .from("deduction_attempts")
    .insert({
      user_id: userId,
      drill_type: drillType,
      difficulty,
      prompt: parsed.prompt,
      answer_key: parsed.answerKey ?? null,
      recall_due: recallDue,
    })
    .select("id,drill_type,difficulty,prompt,recall_due,created_at")
    .single();
  if (error) throw new Error(`Drill generated but could not be saved: ${error.message}`);
  return { row: data };
}

export async function gradeDeductionDrill(
  supabase: Db,
  userId: string,
  attemptId: string,
  response: string,
) {
  const { data: drill, error: loadError } = await supabase
    .from("deduction_attempts")
    .select("id,prompt,answer_key,drill_type,recall_due")
    .eq("id", attemptId)
    .eq("user_id", userId)
    .single();
  if (loadError || !drill) throw new Error("That drill could not be found for this account.");
  if (drill.recall_due && new Date(drill.recall_due).getTime() > Date.now()) {
    throw new Error(
      `This drill tests delayed recall — wait until ${new Date(drill.recall_due).toLocaleTimeString()} before submitting.`,
    );
  }
  const result = await callAI({
    json: true,
    system: `${VOICE} You grade deduction/observation drills strictly but fairly. Score the REASONING PROCESS separately from the CONCLUSION'S ACCURACY — a well-reasoned wrong answer scores higher on reasoning than a lucky guess. Always name at least one thing a trained observer would have noticed that the trainee missed.`,
    messages: [
      {
        role: "user",
        content: `Drill (${drill.drill_type}):\n${drill.prompt}\n\nAnswer key (for grading, not shown to trainee):\n${drill.answer_key ?? "none"}\n\nTrainee response:\n${response}\n\nReturn ONLY JSON: {"reasoningScore": integer 0-100, "accuracyScore": integer 0-100, "feedback": "specific critique, max 100 words, name what a trained observer would have noticed"}`,
      },
    ],
  });
  const parsed = extractJson<{
    reasoningScore?: number;
    accuracyScore?: number;
    feedback?: string;
  }>(result.text);
  if (!parsed) throw new Error(`Grading returned unusable output: ${result.text.slice(0, 200)}`);
  const reasoningScore = Math.max(0, Math.min(100, Math.round(Number(parsed.reasoningScore ?? 0))));
  const accuracyScore = Math.max(0, Math.min(100, Math.round(Number(parsed.accuracyScore ?? 0))));
  const feedback = String(parsed.feedback ?? "");
  const { error } = await supabase
    .from("deduction_attempts")
    .update({
      response,
      reasoning_score: reasoningScore,
      accuracy_score: accuracyScore,
      feedback,
      completed_at: new Date().toISOString(),
    })
    .eq("id", attemptId)
    .eq("user_id", userId);
  if (error) throw new Error(`Graded but could not be saved: ${error.message}`);
  return { reasoningScore, accuracyScore, feedback };
}

// ---------------------------------------------------------------------------
// Metacognition Training (§2.9)
// ---------------------------------------------------------------------------

const METACOGNITION_BRIEFS: Record<string, string> = {
  prediction:
    "Pose a concrete, checkable prediction question about a near-future or knowable-but-unstated fact (e.g. an estimation problem, a forecast about a well-documented trend, a Fermi-style quantity). It must have a specific correct answer you can verify. Do NOT reveal the answer.",
  reasoning_trace:
    "Pose a question that invites a chain of reasoning to reach a conclusion (a logic puzzle, a causal 'why did X happen' question, or a judgement call with a defensible answer). Ask the trainee to show their reasoning trace, not just the answer. Do NOT reveal the answer.",
  change_my_mind:
    "Pose a mildly contentious but well-defined claim the trainee is likely to have an opinion on, and ask them to state one piece of evidence that would change their mind about it. Do NOT reveal any 'correct' stance — there isn't one.",
};

export async function newMetacognitionDrill(supabase: Db, userId: string, drillType: string) {
  const result = await callAI({
    system: `${VOICE} You design calibration-training drills that test whether someone knows what they actually know.`,
    messages: [
      {
        role: "user",
        content: METACOGNITION_BRIEFS[drillType] ?? METACOGNITION_BRIEFS["prediction"]!,
      },
    ],
  });
  const { data, error } = await supabase
    .from("metacognition_attempts")
    .insert({ user_id: userId, drill_type: drillType, prompt: result.text, confidence_pct: 0 })
    .select("id,drill_type,prompt,created_at")
    .single();
  if (error) throw new Error(`Drill generated but could not be saved: ${error.message}`);
  return { row: data };
}

export async function submitMetacognitionDrill(
  supabase: Db,
  userId: string,
  attemptId: string,
  confidencePct: number,
  response: string,
) {
  const { data: drill, error: loadError } = await supabase
    .from("metacognition_attempts")
    .select("id,prompt,drill_type")
    .eq("id", attemptId)
    .eq("user_id", userId)
    .single();
  if (loadError || !drill) throw new Error("That drill could not be found for this account.");

  const isObjective = drill.drill_type === "prediction";
  const result = await callAI({
    json: true,
    system: `${VOICE} You grade metacognition drills. Name specific cognitive biases by their standard name (e.g. confirmation bias, anchoring, availability heuristic, overconfidence effect, hindsight bias) rather than vague generalities — only name ones actually evidenced in the response.`,
    messages: [
      {
        role: "user",
        content: `Drill (${drill.drill_type}):\n${drill.prompt}\n\nTrainee stated confidence: ${confidencePct}%\nTrainee response:\n${response}\n\nReturn ONLY JSON: {${isObjective ? '"correct": boolean, ' : ""}"score": integer 0-100 (quality of reasoning / self-awareness), "biasesIdentified": string[] (named biases actually evidenced, empty array if none), "feedback": "max 90 words"}`,
      },
    ],
  });
  const parsed = extractJson<{
    correct?: boolean;
    score?: number;
    biasesIdentified?: string[];
    feedback?: string;
  }>(result.text);
  if (!parsed) throw new Error(`Grading returned unusable output: ${result.text.slice(0, 200)}`);
  const score = Math.max(0, Math.min(100, Math.round(Number(parsed.score ?? 0))));
  const correct = isObjective ? Boolean(parsed.correct) : null;
  const biasesIdentified = Array.isArray(parsed.biasesIdentified)
    ? parsed.biasesIdentified.filter((b) => typeof b === "string")
    : [];
  const feedback = String(parsed.feedback ?? "");
  const { error } = await supabase
    .from("metacognition_attempts")
    .update({
      confidence_pct: confidencePct,
      response,
      correct,
      score,
      biases_identified: biasesIdentified,
      feedback,
      completed_at: new Date().toISOString(),
    })
    .eq("id", attemptId)
    .eq("user_id", userId);
  if (error) throw new Error(`Graded but could not be saved: ${error.message}`);
  return { correct, score, biasesIdentified, feedback };
}

export async function getMetacognitionStats(supabase: Db, userId: string) {
  const { data } = await supabase
    .from("metacognition_attempts")
    .select("drill_type,confidence_pct,correct,score,biases_identified,completed_at")
    .eq("user_id", userId)
    .not("completed_at", "is", null)
    .order("completed_at", { ascending: true });
  const rows = (data ?? []) as {
    drill_type: string;
    confidence_pct: number;
    correct: boolean | null;
    score: number | null;
    biases_identified: string[];
  }[];

  const objective = rows.filter((r) => r.correct !== null);
  const brierScore = objective.length
    ? objective.reduce((sum, r) => sum + (r.confidence_pct / 100 - (r.correct ? 1 : 0)) ** 2, 0) /
      objective.length
    : null;

  const buckets = [0, 20, 40, 60, 80, 100];
  const calibration = buckets.slice(0, -1).map((lo, i) => {
    const hi = buckets[i + 1]!;
    const inBucket = objective.filter(
      (r) => r.confidence_pct >= lo && r.confidence_pct < (hi === 100 ? 101 : hi),
    );
    const accuracy = inBucket.length
      ? inBucket.filter((r) => r.correct).length / inBucket.length
      : null;
    const avgConfidence = inBucket.length
      ? inBucket.reduce((s, r) => s + r.confidence_pct, 0) / inBucket.length
      : null;
    return { range: `${lo}-${hi}%`, count: inBucket.length, accuracy, avgConfidence };
  });

  const biasCounts = new Map<string, number>();
  for (const r of rows)
    for (const b of r.biases_identified ?? []) biasCounts.set(b, (biasCounts.get(b) ?? 0) + 1);
  const topBiases = [...biasCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);

  return {
    totalAttempts: rows.length,
    brierScore,
    calibration,
    topBiases: topBiases.map(([name, count]) => ({ name, count })),
  };
}

// ---------------------------------------------------------------------------
// Screen share Q&A (§3.4)
// ---------------------------------------------------------------------------

export async function analyzeScreen(image: { base64: string; mimeType: string }, question: string) {
  const result = await callAI({
    image,
    system: `${VOICE} The user is sharing a screenshot of their screen and asking about it. Describe or answer precisely based only on what is visible.`,
    messages: [{ role: "user", content: question || "What's on my screen right now?" }],
  });
  return { answer: result.text, provider: result.provider };
}

// ---------------------------------------------------------------------------
// Image Generation (§2.10)
// ---------------------------------------------------------------------------

export async function createImage(supabase: Db, userId: string, prompt: string) {
  const result = await generateImage(prompt);
  const { data, error } = await supabase
    .from("generated_images")
    .insert({ user_id: userId, prompt, image_data: result.base64, mime_type: result.mimeType })
    .select("id,prompt,image_data,mime_type,created_at")
    .single();
  if (error) throw new Error(`Image generated but could not be saved: ${error.message}`);
  return { row: data };
}
