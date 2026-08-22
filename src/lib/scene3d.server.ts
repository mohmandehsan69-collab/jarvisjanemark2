import { callAI, extractJson } from "./ai.server";

const VOICE = "You are Jarvis, a precise, calm personal assistant. No filler, no flattery.";

/** A single primitive in a generated scene. */
export type ScenePart = {
  /** Stable id assigned after generation — used for selection, hiding, drag. */
  id: string;
  /** Semantic name shown in the UI, e.g. "Ground floor slab", "First floor window". */
  name: string;
  /** Storey or assembly this part belongs to — drives hierarchical drag and
   *  the outliner tree, e.g. "storey-0", "roof", "chassis", "seat". */
  group: string;
  /** Plain-language material, used in the measurement panel: concrete, glass,
   *  brick, timber, steel, fabric, aluminium, rubber, etc. */
  material: string;
  type:
    | "box"
    | "cylinder"
    | "sphere"
    | "cone"
    | "torus"
    | "plane"
    /** Triangular prism — the correct shape for a pitched/gabled roof. */
    | "prism"
    /** Square pyramid — hip roofs, spires, tents. */
    | "pyramid";
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
  /** 0-1. Makes a part glow — lit windows, screens, lamps, thrusters. */
  emissive?: number;
  /** For cylinder/cone: top radius as a fraction of the base radius, so tapered
   *  columns, chimneys and tree trunks are possible. 1 = straight. */
  taper?: number;
  /** Cheap way to express repetition (floors, windows, columns, fence posts)
   *  without the model emitting hundreds of near-identical parts. Each
   *  instance gets its own selectable identity client-side, named
   *  "<name> <index>". */
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
structured scene of geometric primitives that a Three.js viewer renders directly,
with each part individually selectable, measurable, and grouped for the user
to inspect, move, hide or delete.

Rules:
- Output ONLY JSON. No prose, no markdown fences.
- Units are metres. The ground plane is y = 0 and y is up. Objects must sit ON
  the ground (a 10 m tall box has its centre at y = 5), never sunk through it.
- Build shapes by composing primitives. A chair is a seat box, a back box and
  four leg boxes. A rocket is a cylinder plus a cone plus fins.
- Use "repeat" for anything regular: building floors, window bands, columns,
  railings, wheels, fence posts. repeat.count includes the original part.
- Use "prism" for pitched/gabled roofs and "pyramid" for hip roofs and spires.
  Do not fake a sloped roof with a rotated box.
- Use "taper" for anything that narrows: tapered columns, chimneys, tree trunks,
  spires. taper is the top radius as a fraction of the base.
- Use "emissive" around 0.5-0.8 for anything that should glow: lit windows at
  night, signage, lamps, engine exhaust.
- Every part needs a short, specific "name" (e.g. "Ground floor slab", "First
  floor window band", "Roof ridge beam", "Front-left wheel") and a "group" —
  the storey or assembly it belongs to (e.g. "storey-0", "storey-1", "roof",
  "foundation", "chassis", "seat", "engine"). Parts in the same group move
  together when the user drags one of them.
- Every part needs a plain-language "material" (concrete, glass, brick, timber,
  steel, aluminium, fabric, rubber, stone, plaster).

SCALE DISCIPLINE (this is what makes models read as real):
- Storey height is 3.0-3.5 m. A door is 2.1 m tall, 0.9 m wide. A window is
  about 1.5 m tall with a 0.9 m sill. A chair seat is 0.45 m off the floor.
  A car is about 4.5 x 1.8 x 1.5 m. Keep these proportions honest.
- Never emit a part smaller than 0.02 m or larger than 500 m.

DETAIL LEVEL — go genuinely fine-grained, not schematic:
- A house-scale building must include: foundation, floor slabs per storey,
  exterior walls AND interior partitions, a window band with individual frame
  + glass pane + sill per window (not one fused block), door frames and doors,
  roof structure (ridge, rafters or a solid roof volume as appropriate),
  entrance steps, railings, a chimney, and gutters. Model real components.
- Vehicles, furniture, machines, tools and electronics get the same treatment:
  model real assemblies (frame, panels, fasteners-scale details where visible,
  moving parts as separate pieces) grouped sensibly, not one blob per object.
- Prefer 80-300 parts for a building-scale subject and 40-150 for an object,
  and go higher when the subject genuinely warrants it — do not pad with
  meaningless repetition, but do not under-model either.

FOR BUILDINGS specifically:
- Compose real massing: a base/plinth, a shaft of repeated floors, a crown or
  roof. Add setbacks, wings or a projecting core so it is not one plain box.
- Add a floor-slab band (a slightly wider, thinner box) repeated per storey —
  this is what makes a tower read as a building rather than a monolith.
- Glass goes in as a separate part with opacity 0.4-0.5 and metalness 0.6+.
- Add ground context: an entrance canopy, steps, and a low plinth.

FOR OBJECTS specifically:
- Model the silhouette first with 3-6 large parts, then add detail parts.
- Keep symmetry exact: mirrored parts must have mirrored coordinates.

- Give every part a colour that suits its material. Vary tones slightly
  between parts — identical flat colours across everything look artificial.
- Set boundsRadius to roughly half the largest dimension of the whole scene.

Return exactly this shape:
{"name":"short name","description":"one sentence","boundsRadius":number,
 "parts":[{"name":"Ground floor slab","group":"storey-0","material":"concrete",
           "type":"box","position":[0,0.15,0],"size":[10,0.3,10],
           "rotation":[0,0,0],"color":"#8a8f98","opacity":1,
           "metalness":0.1,"roughness":0.8,"emissive":0,"taper":1,
           "repeat":{"count":5,"offset":[0,3,0]}}]}`;

const TYPES = new Set(["box", "cylinder", "sphere", "cone", "torus", "plane", "prism", "pyramid"]);

function num(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function triple(v: unknown, fallback: [number, number, number]): [number, number, number] {
  if (!Array.isArray(v)) return fallback;
  return [num(v[0], fallback[0]), num(v[1], fallback[1]), num(v[2], fallback[2])];
}

let idCounter = 0;
function nextId() {
  idCounter = (idCounter + 1) % 1_000_000;
  return `p${Date.now().toString(36)}${idCounter.toString(36)}`;
}

/** Models drift from any schema, so every field is coerced into something the
 *  renderer can safely consume rather than trusted as-is. */
function sanitize(raw: any): Scene3D {
  const parts: ScenePart[] = [];
  const rawParts = Array.isArray(raw?.parts) ? raw.parts : [];

  for (const p of rawParts.slice(0, 600)) {
    const type = String(p?.type ?? "box").toLowerCase();
    if (!TYPES.has(type)) continue;
    const size = triple(p?.size, [1, 1, 1]).map((n) => Math.min(Math.abs(n) || 1, 5000)) as [
      number,
      number,
      number,
    ];
    const part: ScenePart = {
      id: nextId(),
      name: String(p?.name ?? type).slice(0, 60) || type,
      group: String(p?.group ?? "model").slice(0, 40) || "model",
      material: String(p?.material ?? "material").slice(0, 30) || "material",
      type: type as ScenePart["type"],
      position: triple(p?.position, [0, 0, 0]),
      size,
      rotation: triple(p?.rotation, [0, 0, 0]),
      color:
        typeof p?.color === "string" && /^#[0-9a-f]{3,8}$/i.test(p.color) ? p.color : "#9aa3ad",
      opacity: Math.min(Math.max(num(p?.opacity, 1), 0.05), 1),
      metalness: Math.min(Math.max(num(p?.metalness, 0.1), 0), 1),
      roughness: Math.min(Math.max(num(p?.roughness, 0.75), 0), 1),
      emissive: Math.min(Math.max(num(p?.emissive, 0), 0), 1),
      taper: Math.min(Math.max(num(p?.taper, 1), 0), 4),
    };
    const rc = Math.floor(num(p?.repeat?.count, 1));
    if (rc > 1) {
      part.repeat = { count: Math.min(rc, 150), offset: triple(p?.repeat?.offset, [0, 1, 0]) };
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

export async function generateScene(prompt: string, previous?: Scene3D | null) {
  const refine = previous
    ? `\n\nThis is a REVISION. Current scene JSON:\n${JSON.stringify({
        name: previous.name,
        parts: previous.parts.slice(0, 150).map(({ id: _id, ...rest }) => rest),
      })}\n\nApply the requested change and return the complete updated scene.`
    : "";

  const result = await callAI({
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
