import { callAI, extractJson } from "./ai.server";
import { loadPreferAnthropic } from "./jarvis.server";

type Db = { from: (table: string) => any };

const VOICE =
  "You are Jarvis, a precise, calm personal assistant. No filler, no flattery.";

/** A single primitive in a generated scene. */
export type ScenePart = {
  type: "box" | "cylinder" | "sphere" | "cone" | "torus" | "plane";
  /** [x, y, z] centre position in metres. Ground plane is y = 0. */
  position: [number, number, number];
  /** box: [w,h,d] · cylinder/cone: [radius, height, radius] · sphere: [r,r,r]
   *  torus: [radius, tubeRadius, r] · plane: [w, d, 1] */
  size: [number, number, number];
  /** Euler rotation in degrees. */
  rotation?: [number, number, number];
  color?: string;
  opacity?: number;
  metalness?: number;
  roughness?: number;
  /** Cheap way to express repetition (floors, windows, columns, fence posts)
   *  without the model emitting hundreds of near-identical parts. */
  repeat?: { count: number; offset: [number, number, number] };
};

export type Scene3D = {
  name: string;
  description: string;
  parts: ScenePart[];
  /** Roughly how wide the whole thing is, so the camera can frame it. */
  boundsRadius?: number;
};

const SCENE_SYSTEM = `${VOICE}
You are a 3D scene compiler. You convert a plain-language description into a
structured scene of geometric primitives that a Three.js viewer renders directly.

Rules:
- Output ONLY JSON. No prose, no markdown fences.
- Units are metres. The ground plane is y = 0 and y is up. Objects must sit ON
  the ground (a 10 m tall box has its centre at y = 5), never sunk through it.
- Build shapes by composing primitives. A chair is a seat box, a back box and
  four leg boxes. A rocket is a cylinder plus a cone plus fins.
- Use "repeat" for anything regular: building floors, window bands, columns,
  railings, wheels. repeat.count includes the original part.
- For BUILDINGS: model real massing. Give a footprint, stack floors, add a
  window band per floor via repeat, a roof slab, and a base/entrance. Vary
  massing (setbacks, wings, a core) rather than emitting one plain box.
- Prefer 15-60 parts. Enough to read clearly, few enough to stay fast.
- Give every part a colour that suits the material (concrete, glass, brick,
  timber, steel). Use opacity around 0.45 for glass.
- Set boundsRadius to roughly half the largest dimension of the whole scene.

Return exactly this shape:
{"name":"short name","description":"one sentence","boundsRadius":number,
 "parts":[{"type":"box","position":[0,5,0],"size":[10,10,10],
           "rotation":[0,0,0],"color":"#8a8f98","opacity":1,
           "metalness":0.1,"roughness":0.8,
           "repeat":{"count":5,"offset":[0,3,0]}}]}`;

const TYPES = new Set(["box", "cylinder", "sphere", "cone", "torus", "plane"]);

function num(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function triple(v: unknown, fallback: [number, number, number]): [number, number, number] {
  if (!Array.isArray(v)) return fallback;
  return [num(v[0], fallback[0]), num(v[1], fallback[1]), num(v[2], fallback[2])];
}

/** Models drift from any schema, so every field is coerced into something the
 *  renderer can safely consume rather than trusted as-is. */
function sanitize(raw: any): Scene3D {
  const parts: ScenePart[] = [];
  const rawParts = Array.isArray(raw?.parts) ? raw.parts : [];

  for (const p of rawParts.slice(0, 400)) {
    const type = String(p?.type ?? "box").toLowerCase();
    if (!TYPES.has(type)) continue;
    const size = triple(p?.size, [1, 1, 1]).map((n) => Math.min(Math.abs(n) || 1, 5000)) as [
      number,
      number,
      number,
    ];
    const part: ScenePart = {
      type: type as ScenePart["type"],
      position: triple(p?.position, [0, 0, 0]),
      size,
      rotation: triple(p?.rotation, [0, 0, 0]),
      color: typeof p?.color === "string" && /^#[0-9a-f]{3,8}$/i.test(p.color) ? p.color : "#9aa3ad",
      opacity: Math.min(Math.max(num(p?.opacity, 1), 0.05), 1),
      metalness: Math.min(Math.max(num(p?.metalness, 0.1), 0), 1),
      roughness: Math.min(Math.max(num(p?.roughness, 0.75), 0), 1),
    };
    const rc = Math.floor(num(p?.repeat?.count, 1));
    if (rc > 1) {
      part.repeat = {
        count: Math.min(rc, 120),
        offset: triple(p?.repeat?.offset, [0, 1, 0]),
      };
    }
    parts.push(part);
  }

  if (!parts.length) throw new Error("The model returned no usable geometry. Try rephrasing.");

  return {
    name: String(raw?.name ?? "Untitled").slice(0, 80),
    description: String(raw?.description ?? "").slice(0, 300),
    boundsRadius: Math.min(Math.abs(num(raw?.boundsRadius, 0)) || 0, 5000),
    parts,
  };
}

export async function generateScene(
  supabase: Db,
  userId: string,
  prompt: string,
  previous?: Scene3D | null,
) {
  const preferAnthropic = await loadPreferAnthropic(supabase, userId);
  const refine = previous
    ? `\n\nThis is a REVISION. Current scene JSON:\n${JSON.stringify({
        name: previous.name,
        parts: previous.parts.slice(0, 80),
      })}\n\nApply the requested change and return the complete updated scene.`
    : "";

  const result = await callAI({
    preferAnthropic,
    json: true,
    system: SCENE_SYSTEM,
    messages: [{ role: "user", content: `Build: ${prompt}${refine}` }],
  });

  const parsed = extractJson<any>(result.text);
  if (!parsed) {
    throw new Error(`The model did not return valid scene JSON: ${result.text.slice(0, 200)}`);
  }
  return sanitize(parsed);
}
