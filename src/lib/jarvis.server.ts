import { callAI, extractJson, providerStatus, type AiMessage } from "./ai.server";

type Db = { from: (table: string) => any };

const VOICE =
  "You are Jarvis, a personal assistant. Tone: calm, precise, slightly formal. Never theatrical, never sycophantic. Prefer concrete numbers, units and steps over hedging. If you are unsure, say what you would need to be sure.";

export async function loadPreferAnthropic(supabase: Db, userId: string) {
  const { data } = await supabase
    .from("user_settings")
    .select("ai_provider")
    .eq("user_id", userId)
    .maybeSingle();
  return data?.ai_provider === "anthropic";
}

export async function getProviderStatus(supabase: Db, userId: string) {
  return providerStatus(await loadPreferAnthropic(supabase, userId));
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

export async function runChat(supabase: Db, userId: string, message: string) {
  const preferAnthropic = await loadPreferAnthropic(supabase, userId);
  const memory = await loadMemoryBlock(supabase, userId);
  const { data: history } = await supabase
    .from("chat_messages")
    .select("role,content")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(20);

  const messages: AiMessage[] = [...(history ?? [])]
    .reverse()
    .map((m: any) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content }))
    .concat([{ role: "user", content: message }]);

  const system = `${VOICE}

Known facts about the user (long-term memory):
${memory}

Use those facts naturally when relevant. Never invent facts about the user.
If this message reveals a durable new fact worth remembering (a routine, preference, goal, constraint, or identity detail — not small talk), end your reply with a final line exactly of the form:
MEMORY: {"key":"short_snake_case_key","value":"the fact in one short sentence"}
Emit at most one MEMORY line, and only when the fact is genuinely durable.`;

  const result = await callAI({ system, messages, preferAnthropic });

  let reply = result.text;
  const match = reply.match(/^MEMORY:\s*(\{[\s\S]*\})\s*$/m);
  let savedMemory: { key: string; value: string } | null = null;
  if (match) {
    reply = reply.replace(match[0], "").trim();
    const parsed = extractJson<{ key?: string; value?: string }>(match[1]!);
    if (parsed?.key && parsed?.value) {
      savedMemory = { key: String(parsed.key).slice(0, 80), value: String(parsed.value).slice(0, 400) };
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
    { user_id: userId, role: "assistant", content: reply, provider: result.provider },
  ]);
  if (error) throw new Error(`Reply generated but could not be saved: ${error.message}`);

  return { reply, provider: result.provider, model: result.model, savedMemory };
}

export type Trend = {
  topic: string;
  direction: "rising" | "falling" | "steady";
  reasoning: string;
  sources: string[];
};

export async function runTrends(supabase: Db, userId: string, keyword: string, source = "manual") {
  const preferAnthropic = await loadPreferAnthropic(supabase, userId);
  const result = await callAI({
    system: `${VOICE} You are a trend analyst. Research current public signals with the search tool before answering.`,
    search: true,
    preferAnthropic,
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

export async function runEngineering(supabase: Db, userId: string, question: string) {
  const preferAnthropic = await loadPreferAnthropic(supabase, userId);
  const result = await callAI({
    search: true,
    preferAnthropic,
    system: `${VOICE} You are a chartered engineer across mechanical, electrical, civil/structural and software engineering. Work step by step: restate the problem, list assumptions and given values with units, show each calculation line, then state the answer with units and a sanity check. Verify code clauses, material properties and standards against sources rather than memory, and name the standard/edition you relied on. Flag safety-critical items and state clearly when a licensed engineer must sign off.`,
    messages: [{ role: "user", content: question }],
  });
  return { answer: result.text, sources: result.sources, provider: result.provider };
}

export async function runResearch(
  supabase: Db,
  userId: string,
  topic: string,
  outputType: string,
) {
  const preferAnthropic = await loadPreferAnthropic(supabase, userId);
  const shape: Record<string, string> = {
    summary: "a structured briefing with key findings, open questions and next steps",
    spec: "a technical specification with scope, requirements (numbered), constraints and acceptance criteria",
    comparison: "a comparison document with a criteria table, per-option analysis and a recommendation",
    draft: "a polished draft document ready to send, with headings and a short executive summary",
  };
  const result = await callAI({
    search: true,
    preferAnthropic,
    system: `${VOICE} You are a research analyst. Method: (1) search broadly, (2) re-query from at least two different angles to cross-check the main claims, including Wikipedia for background, (3) reconcile disagreements explicitly. Mark any claim you could not corroborate as UNVERIFIED. Output markdown.`,
    messages: [
      {
        role: "user",
        content: `Research: ${topic}\n\nProduce ${shape[outputType] ?? shape["summary"]}. Cross-check the central claims and include a "Sources" section with URLs and a "Confidence" note at the end.`,
      },
    ],
  });
  const { data, error } = await supabase
    .from("research_reports")
    .insert({
      user_id: userId,
      topic,
      output_type: outputType,
      body: result.text,
      sources: result.sources,
    })
    .select("id,topic,output_type,body,sources,created_at")
    .single();
  if (error) throw new Error(`Report generated but could not be saved: ${error.message}`);
  return { row: data, provider: result.provider };
}

export async function runDrill(supabase: Db, userId: string, drillType: string) {
  const preferAnthropic = await loadPreferAnthropic(supabase, userId);
  const briefs: Record<string, string> = {
    deduction:
      "Write a short observation scenario (max 120 words) describing a person or scene in concrete physical detail, then ask the trainee what can be deduced. Do NOT reveal the answer.",
    observation:
      "Write a dense 100-word scene description containing exactly 8 checkable details, then ask 3 recall questions about it. Do NOT reveal the answers.",
    memory_palace:
      "Give a list of 10 unrelated concrete items to place in a memory palace, with a one-line placement instruction. State that recall will be tested later. Do NOT reveal any answer key.",
  };
  const result = await callAI({
    preferAnthropic,
    system: `${VOICE} You design cognitive training drills. Be concrete and specific; avoid mysticism and avoid claiming cold reading is infallible.`,
    messages: [{ role: "user", content: briefs[drillType] ?? briefs["deduction"]! }],
  });
  const recallDue =
    drillType === "memory_palace" ? new Date(Date.now() + 6 * 3600_000).toISOString() : null;
  const { data, error } = await supabase
    .from("training_progress")
    .insert({
      user_id: userId,
      drill_type: drillType,
      prompt: result.text,
      recall_due: recallDue,
    })
    .select("id,drill_type,prompt,recall_due,created_at")
    .single();
  if (error) throw new Error(`Drill generated but could not be saved: ${error.message}`);
  return { row: data, provider: result.provider };
}

export async function gradeDrill(
  supabase: Db,
  userId: string,
  drillId: string,
  response: string,
) {
  const preferAnthropic = await loadPreferAnthropic(supabase, userId);
  const { data: drill, error: loadError } = await supabase
    .from("training_progress")
    .select("id,prompt,drill_type")
    .eq("id", drillId)
    .eq("user_id", userId)
    .single();
  if (loadError || !drill) throw new Error("That drill could not be found for this account.");
  const result = await callAI({
    preferAnthropic,
    json: true,
    system: `${VOICE} You grade cognitive drills strictly but fairly.`,
    messages: [
      {
        role: "user",
        content: `Drill:\n${drill.prompt}\n\nTrainee answer:\n${response}\n\nReturn ONLY JSON: {"score": integer 0-100, "feedback": "specific critique, max 90 words, name one thing to do differently next time"}`,
      },
    ],
  });
  const parsed = extractJson<{ score?: number; feedback?: string }>(result.text);
  if (!parsed) throw new Error(`Grading returned unusable output: ${result.text.slice(0, 200)}`);
  const score = Math.max(0, Math.min(100, Math.round(Number(parsed.score ?? 0))));
  const feedback = String(parsed.feedback ?? "");
  const { error } = await supabase
    .from("training_progress")
    .update({ response, score, completed_at: new Date().toISOString() })
    .eq("id", drillId)
    .eq("user_id", userId);
  if (error) throw new Error(`Graded but could not be saved: ${error.message}`);
  return { score, feedback };
}

export async function generateFlashcards(
  supabase: Db,
  userId: string,
  topic: string,
  deck: string,
  count: number,
) {
  const preferAnthropic = await loadPreferAnthropic(supabase, userId);
  const result = await callAI({
    preferAnthropic,
    json: true,
    system: `${VOICE} You write spaced-repetition flashcards: one atomic fact per card, question on the front, minimal answer on the back.`,
    messages: [
      {
        role: "user",
        content: `Create ${count} flashcards about "${topic}". Return ONLY a JSON array of {"front": string, "back": string}.`,
      },
    ],
  });
  const parsed = extractJson<{ front: string; back: string }[]>(result.text);
  if (!parsed?.length) throw new Error(`No usable cards returned: ${result.text.slice(0, 200)}`);
  const rows = parsed
    .filter((c) => c?.front && c?.back)
    .slice(0, 30)
    .map((c) => ({ user_id: userId, front: String(c.front), back: String(c.back), deck }));
  const { error } = await supabase.from("flashcards").insert(rows);
  if (error) throw new Error(`Cards generated but could not be saved: ${error.message}`);
  return { created: rows.length };
}