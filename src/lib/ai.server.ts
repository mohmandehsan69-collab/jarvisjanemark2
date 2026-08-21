// Provider-agnostic AI layer. Never fails silently: every path throws a
// descriptive Error that is surfaced to the UI. See spec §4 and §5.3/5.4.

export type ProviderId = "gemini" | "lovable" | "anthropic";

export type AiMessage = { role: "user" | "assistant"; content: string };

export type AiRequest = {
  system: string;
  messages: AiMessage[];
  /** Enable web-search grounding (google_search / web_search tools). */
  search?: boolean;
  /** Ask the provider for raw JSON output. */
  json?: boolean;
  /** Voice/face path: optimise for latency over exhaustiveness. */
  voice?: boolean;
  /** Force a specific provider (used by cross-check to get a second opinion). */
  forceProvider?: ProviderId;
  /** Screen-share Q&A (§3.4): attach one image to the latest user turn. Gemini-only. */
  image?: { base64: string; mimeType: string };
};

export type AiResult = {
  text: string;
  provider: ProviderId;
  model: string;
  sources: { title: string; url: string }[];
};

// Model IDs drift: a hardcoded id is the single most common cause of a hard
// failure here (e.g. "gemini-2.5-flash is not found for API version v1beta").
// So each transport gets an ordered candidate list, newest first, and we fall
// through to the next id on a 404/400 "model not found" style rejection.
const GEMINI_DIRECT_MODELS = ["gemini-3.7-flash", "gemini-flash-latest"];
const GEMINI_IMAGE_MODELS = ["gemini-3.7-flash-image", "gemini-flash-latest-image"];
const GEMINI_TTS_MODELS = ["gemini-3.7-flash-tts", "gemini-flash-latest-tts"];
const LOVABLE_MODELS = ["google/gemini-3.6-flash"];
const ANTHROPIC_MODEL = "claude-sonnet-4-6";

const VOICE_SYSTEM_SUFFIX =
  "\n\nThis is a spoken voice conversation. Answer in 2-3 short spoken sentences unless the user explicitly asks for detail. No markdown, no lists.";
const VOICE_MAX_TOKENS = 400;

function env(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : undefined;
}

/** The spec demands GEMINI_API_KEY, but a past build stored it misspelled.
 *  Accept both so a typo can never silently disable the default provider. */
function geminiKey(): string | undefined {
  return env("GEMINI_API_KEY") ?? env("GEMIN_API_KEY");
}

/** True when the provider rejected the model id itself rather than the request. */
function isModelRejection(status: number, body: string): boolean {
  if (status !== 404 && status !== 400) return false;
  const b = body.toLowerCase();
  return (
    b.includes("not found") ||
    b.includes("not supported") ||
    b.includes("unsupported model") ||
    b.includes("invalid model") ||
    b.includes("does not exist") ||
    b.includes("deprecated") ||
    b.includes("no longer available")
  );
}

/** Transient upstream conditions: worth retrying, then worth failing over. */
function isTransient(status: number): boolean {
  return status === 429 || status === 503 || status === 500 || status === 502 || status === 504;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** POST with bounded retry + jitter on transient statuses. */
async function fetchWithRetry(
  url: string,
  init: RequestInit,
  attempts = 3,
  maxDelayMs = 8000,
): Promise<Response> {
  let res = await fetch(url, init);
  for (let i = 1; i < attempts && isTransient(res.status); i++) {
    const retryAfter = Number(res.headers.get("retry-after"));
    const waitMs =
      Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(retryAfter * 1000, maxDelayMs)
        : Math.min(400 * 2 ** (i - 1) + Math.random() * 250, maxDelayMs);
    await sleep(waitMs);
    res = await fetch(url, init);
  }
  return res;
}

export function providerStatus() {
  return {
    gemini: Boolean(geminiKey()),
    lovable: Boolean(env("LOVABLE_API_KEY")),
    anthropic: Boolean(env("ANTHROPIC_API_KEY")),
    active: resolveProvider(undefined),
  };
}

function resolveProvider(forced: ProviderId | undefined): ProviderId | null {
  if (forced) {
    if (forced === "gemini" && geminiKey()) return "gemini";
    if (forced === "lovable" && env("LOVABLE_API_KEY")) return "lovable";
    if (forced === "anthropic" && env("ANTHROPIC_API_KEY")) return "anthropic";
    return null;
  }
  if (geminiKey()) return "gemini";
  if (env("LOVABLE_API_KEY")) return "lovable";
  if (env("ANTHROPIC_API_KEY")) return "anthropic";
  return null;
}

/** The next configured provider after `p`, used to get a genuinely different
 *  opinion for cross-checking (spec §3.3: "a different provider if configured"). */
export function secondaryProvider(exclude: ProviderId): ProviderId | null {
  const order: ProviderId[] = ["gemini", "lovable", "anthropic"];
  for (const p of order) {
    if (p === exclude) continue;
    if (p === "gemini" && geminiKey()) return p;
    if (p === "lovable" && env("LOVABLE_API_KEY")) return p;
    if (p === "anthropic" && env("ANTHROPIC_API_KEY")) return p;
  }
  return null;
}

async function readError(res: Response): Promise<string> {
  let body = "";
  try {
    body = (await res.text()).slice(0, 600);
  } catch {
    body = "<unreadable response body>";
  }
  if (res.status === 401 || res.status === 403) {
    return `authentication rejected (HTTP ${res.status}). The API key is missing, wrong, or lacks access. ${body}`;
  }
  if (res.status === 429) {
    return `rate limit / quota exceeded (HTTP 429). Wait and retry. ${body}`;
  }
  if (res.status === 402) {
    return `payment required (HTTP 402). Credits are exhausted for this provider. ${body}`;
  }
  return `HTTP ${res.status}. ${body}`;
}

export async function callAI(req: AiRequest): Promise<AiResult> {
  if (req.image && !geminiKey()) {
    throw new Error("Add a GEMINI_API_KEY secret — image input (screen share) is Gemini-only.");
  }
  const provider = req.image ? "gemini" : resolveProvider(req.forceProvider);
  if (!provider) {
    throw new Error(
      req.forceProvider
        ? `No secret is configured for the requested provider "${req.forceProvider}".`
        : "No AI provider is available. Add a GEMINI_API_KEY secret (the app's default provider).",
    );
  }

  const run = (p: ProviderId) =>
    p === "gemini" ? callGemini(req) : p === "anthropic" ? callAnthropic(req) : callLovable(req);

  // Ordered chain: chosen provider first, then any other configured provider —
  // except when a specific provider was forced (cross-check second opinion) or
  // an image is attached (only Gemini supports it here), where a silent
  // fallback would defeat the point.
  const chain: ProviderId[] = [provider];
  if (!req.forceProvider && !req.image) {
    if (req.voice) {
      // Latency path: one fast failover target only.
      if (provider !== "lovable" && env("LOVABLE_API_KEY")) chain.push("lovable");
    } else {
      for (const fallback of ["lovable", "gemini", "anthropic"] as ProviderId[]) {
        if (chain.includes(fallback)) continue;
        if (fallback === "gemini" && !geminiKey()) continue;
        if (fallback === "lovable" && !env("LOVABLE_API_KEY")) continue;
        if (fallback === "anthropic" && !env("ANTHROPIC_API_KEY")) continue;
        chain.push(fallback);
      }
    }
  }

  const failures: string[] = [];
  for (const p of chain) {
    try {
      return await run(p);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      failures.push(`${p}: ${detail}`);
      // Only fail over when the provider itself is unavailable/overloaded.
      if (!/HTTP (429|5\d\d)|overload|high demand|unavailable|no usable/i.test(detail)) {
        throw new Error(`AI request failed via ${p}: ${detail}`);
      }
    }
  }
  throw new Error(
    `Every configured AI provider is currently unavailable. Details — ${failures.join(" | ")}`,
  );
}

function geminiBody(req: AiRequest) {
  const contents = req.messages.map((m, i) => {
    const parts: Record<string, unknown>[] = [{ text: m.content }];
    const isLastUserTurn = req.image && i === req.messages.length - 1 && m.role === "user";
    if (isLastUserTurn) {
      parts.push({ inlineData: { mimeType: req.image!.mimeType, data: req.image!.base64 } });
    }
    return { role: m.role === "assistant" ? "model" : "user", parts };
  });
  const body: Record<string, unknown> = {
    systemInstruction: {
      parts: [{ text: req.voice ? req.system + VOICE_SYSTEM_SUFFIX : req.system }],
    },
    contents,
    generationConfig: {
      temperature: 0.6,
      maxOutputTokens: req.voice ? VOICE_MAX_TOKENS : 2048,
      // Gemini 3.x Flash reasons before answering by default, which can add many
      // seconds of latency. Voice needs speed far more than deliberation.
      ...(req.voice ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
    },
  };
  // Grounding and JSON mime type are mutually exclusive on Gemini.
  if (req.search) body["tools"] = [{ google_search: {} }];
  else if (req.json)
    body["generationConfig"] = {
      temperature: 0.3,
      maxOutputTokens: 2048,
      responseMimeType: "application/json",
    };
  return body;
}

async function callGemini(req: AiRequest): Promise<AiResult> {
  const key = geminiKey()!;
  const body = geminiBody(req);

  let data: any;
  let usedModel = "";
  const rejected: string[] = [];
  const models = req.voice ? GEMINI_DIRECT_MODELS : GEMINI_DIRECT_MODELS;
  for (const model of models) {
    const res = await fetchWithRetry(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify(body),
      },
      req.voice ? 2 : 3,
      req.voice ? 400 : 8000,
    );
    if (res.ok) {
      usedModel = model;
      data = await res.json();
      break;
    }
    const detail = await readError(res);
    // Walk to the next candidate when the id was refused, or when this model is
    // still overloaded after retries — a sibling model usually has capacity.
    if (isModelRejection(res.status, detail) || isTransient(res.status)) {
      rejected.push(`${model} -> ${detail.slice(0, 150)}`);
      continue;
    }
    throw new Error(`${detail} (model: ${model})`);
  }
  if (!usedModel) {
    throw new Error(`no usable Gemini flash model right now. Attempts: ${rejected.join(" | ")}`);
  }
  const candidate = data?.candidates?.[0];
  const text: string = (candidate?.content?.parts ?? [])
    .map((p: any) => p?.text ?? "")
    .join("")
    .trim();
  if (!text) {
    throw new Error(
      `empty response (finishReason: ${candidate?.finishReason ?? "unknown"}). ${JSON.stringify(data?.promptFeedback ?? {}).slice(0, 300)}`,
    );
  }
  const chunks = candidate?.groundingMetadata?.groundingChunks ?? [];
  const sources = chunks
    .map((c: any) => ({ title: c?.web?.title ?? "source", url: c?.web?.uri ?? "" }))
    .filter((s: { url: string }) => s.url);
  return { text, provider: "gemini", model: usedModel, sources };
}

/** Raw streaming path for Face/floating-mic voice turns. Returns the upstream
 *  fetch Response directly (ok + streaming body) so the caller can pipe SSE
 *  bytes straight to the browser — no buffering, no re-framing. Spec §2.2:
 *  "speak the first complete sentence the moment it arrives". Tries at most
 *  the two Gemini candidates; never walks a longer fallback chain here —
 *  latency matters more than exhaustiveness on this path. */
export async function streamGeminiVoice(
  system: string,
  messages: AiMessage[],
): Promise<{ response: Response; model: string }> {
  const key = geminiKey();
  if (!key) throw new Error("Add a GEMINI_API_KEY secret to use voice mode.");
  const body = geminiBody({ system, messages, voice: true });
  const rejected: string[] = [];
  for (const model of GEMINI_DIRECT_MODELS) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`,
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify(body),
      },
    );
    if (res.ok) return { response: res, model };
    const detail = await readError(res);
    if (isModelRejection(res.status, detail)) {
      rejected.push(`${model} -> ${detail.slice(0, 150)}`);
      continue;
    }
    throw new Error(`${detail} (model: ${model})`);
  }
  throw new Error(
    `no usable Gemini flash model for streaming voice. Attempts: ${rejected.join(" | ")}`,
  );
}

async function callLovable(req: AiRequest): Promise<AiResult> {
  const key = env("LOVABLE_API_KEY")!;
  const system = req.voice ? req.system + VOICE_SYSTEM_SUFFIX : req.system;
  const messages = [
    {
      role: "system",
      content: req.search
        ? `${system}\n\nYou have no live browsing here: state clearly when a claim may be stale, and cite well-known primary sources by URL where possible.`
        : system,
    },
    ...req.messages,
  ];
  const rejected: string[] = [];
  for (const model of req.voice ? LOVABLE_MODELS.slice(0, 1) : LOVABLE_MODELS) {
    const res = await fetchWithRetry(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: { "content-type": "application/json", "Lovable-API-Key": key },
        body: JSON.stringify({
          model,
          messages,
          temperature: req.json ? 0.3 : 0.6,
          ...(req.voice ? { max_tokens: VOICE_MAX_TOKENS } : {}),
        }),
      },
      req.voice ? 2 : 3,
      req.voice ? 400 : 8000,
    );
    if (!res.ok) {
      const detail = await readError(res);
      if (isModelRejection(res.status, detail) || isTransient(res.status)) {
        rejected.push(`${model} -> ${detail.slice(0, 150)}`);
        continue;
      }
      throw new Error(`${detail} (model: ${model})`);
    }
    const data = (await res.json()) as any;
    const text: string = data?.choices?.[0]?.message?.content?.trim?.() ?? "";
    if (!text) throw new Error(`empty response: ${JSON.stringify(data).slice(0, 300)}`);
    return { text, provider: "lovable", model, sources: [] };
  }
  throw new Error(`no usable gateway model right now (tried: ${rejected.join(", ")}).`);
}

async function callAnthropic(req: AiRequest): Promise<AiResult> {
  const key = env("ANTHROPIC_API_KEY")!;
  const res = await fetchWithRetry("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: req.voice ? VOICE_MAX_TOKENS : 2048,
      system: req.voice ? req.system + VOICE_SYSTEM_SUFFIX : req.system,
      messages: req.messages,
      ...(req.search
        ? { tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 4 }] }
        : {}),
    }),
  });
  if (!res.ok) throw new Error(await readError(res));
  const data = (await res.json()) as any;
  const blocks: any[] = data?.content ?? [];
  const text = blocks
    .filter((b) => b?.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
  if (!text) throw new Error(`empty response: ${JSON.stringify(data).slice(0, 300)}`);
  const sources: { title: string; url: string }[] = [];
  for (const b of blocks) {
    for (const c of b?.citations ?? []) {
      if (c?.url) sources.push({ title: c.title ?? c.url, url: c.url });
    }
  }
  return { text, provider: "anthropic", model: ANTHROPIC_MODEL, sources };
}

/** Spec §3.3: run the same question twice — a different framing, and a
 *  different provider when one is configured — then let the caller reconcile
 *  agreement vs disagreement. Never silently picks one answer. */
export async function runCrossCheck(args: {
  system: string;
  question: string;
  search?: boolean;
}): Promise<{ a: AiResult; b: AiResult; secondPassProvider: ProviderId | null }> {
  const search = Boolean(args.search);
  const passA = callAI({
    system: args.system,
    search,
    messages: [{ role: "user", content: args.question }],
  });

  const other = secondaryProvider("gemini");
  const reframed = `Answer this from a fresh, independent pass — do not assume your own prior answer. Re-derive from first principles and re-verify facts:\n\n${args.question}`;
  const passB = callAI({
    system: args.system,
    search,
    ...(other ? { forceProvider: other } : {}),
    messages: [{ role: "user", content: reframed }],
  });

  const [a, b] = await Promise.all([passA, passB]);
  return { a, b, secondPassProvider: other };
}

/** Tolerant JSON extraction — models wrap JSON in prose or code fences. */
export function extractJson<T>(text: string): T | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = [fenced?.[1], text];
  for (const raw of candidates) {
    if (!raw) continue;
    const trimmed = raw.trim();
    const start = trimmed.search(/[[{]/);
    if (start < 0) continue;
    const end = Math.max(trimmed.lastIndexOf("]"), trimmed.lastIndexOf("}"));
    if (end <= start) continue;
    try {
      return JSON.parse(trimmed.slice(start, end + 1)) as T;
    } catch {
      continue;
    }
  }
  return null;
}

/** Spec §2.10: text-to-image generation. */
export async function generateImage(
  prompt: string,
): Promise<{ base64: string; mimeType: string; provider: "gemini"; model: string }> {
  const key = geminiKey();
  if (!key) throw new Error("Add a GEMINI_API_KEY secret to generate images.");
  const rejected: string[] = [];
  for (const model of GEMINI_IMAGE_MODELS) {
    const res = await fetchWithRetry(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { responseModalities: ["IMAGE"] },
        }),
      },
    );
    if (!res.ok) {
      const detail = await readError(res);
      if (isModelRejection(res.status, detail) || isTransient(res.status)) {
        rejected.push(`${model} -> ${detail.slice(0, 150)}`);
        continue;
      }
      throw new Error(`${detail} (model: ${model})`);
    }
    const data = (await res.json()) as any;
    const parts: any[] = data?.candidates?.[0]?.content?.parts ?? [];
    const inline = parts.find((p) => p?.inlineData?.data)?.inlineData;
    if (!inline?.data) {
      throw new Error(
        `Image model returned no image data (finishReason: ${data?.candidates?.[0]?.finishReason ?? "unknown"}).`,
      );
    }
    return {
      base64: inline.data,
      mimeType: inline.mimeType ?? "image/png",
      provider: "gemini",
      model,
    };
  }
  throw new Error(`no usable Gemini image model right now. Attempts: ${rejected.join(" | ")}`);
}

/** Spec §5.2: server-side TTS for languages with no installed browser voice
 *  (Persian/Dari has none on Windows). Returns a playable WAV, base64-encoded —
 *  Gemini TTS returns headerless 16-bit PCM, which browsers cannot play as-is. */
export async function synthesizeSpeech(
  text: string,
  languageHint: string,
): Promise<{ base64Wav: string; provider: "gemini"; model: string }> {
  const key = geminiKey();
  if (!key) throw new Error("Add a GEMINI_API_KEY secret to use server-side speech.");
  const rejected: string[] = [];
  for (const model of GEMINI_TTS_MODELS) {
    const res = await fetchWithRetry(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          contents: [
            { role: "user", parts: [{ text: `Say this naturally, in ${languageHint}: ${text}` }] },
          ],
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Puck" } } },
          },
        }),
      },
    );
    if (!res.ok) {
      const detail = await readError(res);
      if (isModelRejection(res.status, detail) || isTransient(res.status)) {
        rejected.push(`${model} -> ${detail.slice(0, 150)}`);
        continue;
      }
      throw new Error(`${detail} (model: ${model})`);
    }
    const data = (await res.json()) as any;
    const inline = (data?.candidates?.[0]?.content?.parts ?? []).find(
      (p: any) => p?.inlineData?.data,
    )?.inlineData;
    if (!inline?.data) throw new Error("Speech model returned no audio data.");
    const rateMatch = /rate=(\d+)/.exec(inline.mimeType ?? "");
    const sampleRate = rateMatch ? Number(rateMatch[1]) : 24000;
    return { base64Wav: pcmToWavBase64(inline.data, sampleRate), provider: "gemini", model };
  }
  throw new Error(`no usable Gemini speech model right now. Attempts: ${rejected.join(" | ")}`);
}

/** Wraps headerless 16-bit mono PCM (base64) in a minimal WAV container so
 *  browsers can play it via an <audio> element. */
function pcmToWavBase64(base64Pcm: string, sampleRate: number): string {
  const pcm = Buffer.from(base64Pcm, "base64");
  const header = Buffer.alloc(44);
  const byteRate = sampleRate * 2;
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write("data", 36, "ascii");
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]).toString("base64");
}
