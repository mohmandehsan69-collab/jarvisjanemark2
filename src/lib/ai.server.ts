// Provider-agnostic AI layer. Never fails silently: every path throws a
// descriptive Error that is surfaced to the UI.

export type ProviderId = "gemini" | "lovable" | "anthropic";

export type AiMessage = { role: "user" | "assistant"; content: string };

export type AiRequest = {
  system: string;
  messages: AiMessage[];
  /** Enable web-search grounding (google_search / web_search tools). */
  search?: boolean;
  /** Ask the provider for raw JSON output. */
  json?: boolean;
  preferAnthropic?: boolean;
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
const GEMINI_DIRECT_MODELS = [
  "gemini-flash-latest",
  "gemini-3.7-flash",
  "gemini-3-flash",
  "gemini-2.5-flash",
];
const LOVABLE_MODELS = ["google/gemini-3.6-flash", "google/gemini-2.5-flash"];
const ANTHROPIC_MODEL = "claude-sonnet-4-6";

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
    b.includes("deprecated")
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
): Promise<Response> {
  let res = await fetch(url, init);
  for (let i = 1; i < attempts && isTransient(res.status); i++) {
    const retryAfter = Number(res.headers.get("retry-after"));
    const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
      ? Math.min(retryAfter * 1000, 8000)
      : 400 * 2 ** (i - 1) + Math.random() * 250;
    await sleep(waitMs);
    res = await fetch(url, init);
  }
  return res;
}

export function providerStatus(preferAnthropic: boolean) {
  const gemini = Boolean(geminiKey());
  const lovable = Boolean(env("LOVABLE_API_KEY"));
  const anthropic = Boolean(env("ANTHROPIC_API_KEY"));
  return {
    gemini,
    lovable,
    anthropic,
    active: resolveProvider(preferAnthropic),
  };
}

function resolveProvider(preferAnthropic: boolean): ProviderId | null {
  if (preferAnthropic && env("ANTHROPIC_API_KEY")) return "anthropic";
  if (geminiKey()) return "gemini";
  if (env("LOVABLE_API_KEY")) return "lovable";
  if (env("ANTHROPIC_API_KEY")) return "anthropic";
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
    return `rate limit / quota exceeded (HTTP 429). Wait and retry, or switch provider in Settings. ${body}`;
  }
  if (res.status === 402) {
    return `payment required (HTTP 402). Credits are exhausted for this provider. ${body}`;
  }
  return `HTTP ${res.status}. ${body}`;
}

export async function callAI(req: AiRequest): Promise<AiResult> {
  const provider = resolveProvider(Boolean(req.preferAnthropic));
  if (!provider) {
    throw new Error(
      "No AI provider is available. Add a GEMINI_API_KEY secret, or make sure the built-in Lovable AI gateway key (LOVABLE_API_KEY) is present.",
    );
  }
  if (req.preferAnthropic && provider !== "anthropic") {
    // Explicit opt-in was requested but the key is absent — say so loudly.
    throw new Error(
      'Settings is set to "my own Anthropic key" but no ANTHROPIC_API_KEY secret exists. Add the secret (name must match exactly) or switch back to the default provider.',
    );
  }

  const run = (p: ProviderId) =>
    p === "gemini" ? callGemini(req) : p === "anthropic" ? callAnthropic(req) : callLovable(req);

  // Ordered chain: chosen provider first, then any other configured provider.
  const chain: ProviderId[] = [provider];
  for (const fallback of ["lovable", "gemini", "anthropic"] as ProviderId[]) {
    if (chain.includes(fallback)) continue;
    if (fallback === "gemini" && !geminiKey()) continue;
    if (fallback === "lovable" && !env("LOVABLE_API_KEY")) continue;
    if (fallback === "anthropic" && !env("ANTHROPIC_API_KEY")) continue;
    chain.push(fallback);
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

async function callGemini(req: AiRequest): Promise<AiResult> {
  const key = geminiKey()!;
  const body: Record<string, unknown> = {
    systemInstruction: { parts: [{ text: req.system }] },
    contents: req.messages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    })),
    generationConfig: { temperature: 0.6, maxOutputTokens: 2048 },
  };
  // Grounding and JSON mime type are mutually exclusive on Gemini.
  if (req.search) body["tools"] = [{ google_search: {} }];
  else if (req.json)
    body["generationConfig"] = {
      temperature: 0.3,
      maxOutputTokens: 2048,
      responseMimeType: "application/json",
    };

  let data: any;
  let usedModel = "";
  const rejected: string[] = [];
  for (const model of GEMINI_DIRECT_MODELS) {
    const res = await fetchWithRetry(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify(body),
      },
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
      rejected.push(model);
      continue;
    }
    throw new Error(`${detail} (model: ${model})`);
  }
  if (!usedModel) {
    throw new Error(
      `no usable Gemini flash model right now (tried: ${rejected.join(", ")}) — the model was either renamed or overloaded (HTTP 503).`,
    );
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

async function callLovable(req: AiRequest): Promise<AiResult> {
  const key = env("LOVABLE_API_KEY")!;
  const messages = [
    {
      role: "system",
      content: req.search
        ? `${req.system}\n\nYou have no live browsing here: state clearly when a claim may be stale, and cite well-known primary sources by URL where possible.`
        : req.system,
    },
    ...req.messages,
  ];
  const rejected: string[] = [];
  for (const model of LOVABLE_MODELS) {
    const res = await fetchWithRetry("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", "Lovable-API-Key": key },
      body: JSON.stringify({ model, messages, temperature: req.json ? 0.3 : 0.6 }),
    });
    if (!res.ok) {
      const detail = await readError(res);
      if (isModelRejection(res.status, detail) || isTransient(res.status)) {
        rejected.push(model);
        continue;
      }
      throw new Error(`${detail} (model: ${model})`);
    }
    const data = (await res.json()) as any;
    const text: string = data?.choices?.[0]?.message?.content?.trim?.() ?? "";
    if (!text) throw new Error(`empty response: ${JSON.stringify(data).slice(0, 300)}`);
    return { text, provider: "lovable", model, sources: [] };
  }
  throw new Error(
    `no usable gateway model right now (tried: ${rejected.join(", ")}).`,
  );
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
      max_tokens: 2048,
      system: req.system,
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