import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Box,
  ChevronDown,
  ChevronRight,
  Download,
  Eye,
  EyeOff,
  Loader2,
  Maximize2,
  Minimize2,
  Move,
  RotateCw,
  Trash2,
  Undo2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Page } from "@/components/app/Page";
import {
  SceneViewer,
  type DisplayMode,
  type SelectionInfo,
  type ViewerApi,
} from "@/components/SceneViewer";
import { buildScene } from "@/lib/scene3d.functions";
import type { Scene3D } from "@/lib/scene3d.server";
import { consumePendingInstruction } from "@/lib/voice-router";
import { cn } from "@/lib/utils";

const title = "3D studio — build models from a description";
const description =
  "Describe a building or object and Jarvis composes it from geometric primitives with real-world scale, rendered live in the browser.";

export const Route = createFileRoute("/_authenticated/studio")({
  head: () => ({
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: StudioPage,
});

const EXAMPLES = [
  "A 12-storey office tower with a glass curtain wall and a stone base",
  "A traditional walled compound house with a courtyard",
  "A wooden dining chair",
  "A two-stage rocket on a launch pad",
];

type UndoEntry = { hiddenGroups: Set<string>; hiddenInstances: Set<string> };

function StudioPage() {
  const build = useServerFn(buildScene);
  const [prompt, setPrompt] = useState("");
  const [scene, setScene] = useState<Scene3D | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [full, setFull] = useState(false);
  const [mode, setMode] = useState<DisplayMode>("solid");
  const [spin, setSpin] = useState(false);
  const [explode, setExplode] = useState(0);
  const [moveMode, setMoveMode] = useState(false);
  const [hiddenGroups, setHiddenGroups] = useState<Set<string>>(new Set());
  const [hiddenInstances, setHiddenInstances] = useState<Set<string>>(new Set());
  const [groupOffsets, setGroupOffsets] = useState<Record<string, [number, number, number]>>({});
  const [selected, setSelected] = useState<SelectionInfo | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [api, setApi] = useState<ViewerApi | null>(null);
  const undoStack = useRef<UndoEntry[]>([]);
  const ranPending = useRef(false);

  const run = async (text: string, refine: boolean) => {
    const value = text.trim();
    if (!value || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await build({ data: { prompt: value, previous: refine ? scene : undefined } });
      setScene(result as Scene3D);
      setPrompt("");
      setHiddenGroups(new Set());
      setHiddenInstances(new Set());
      setGroupOffsets({});
      setSelected(null);
      undoStack.current = [];
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (ranPending.current) return;
    ranPending.current = true;
    const pending = consumePendingInstruction();
    if (pending) void run(pending, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const groups = useMemo(() => {
    if (!scene) return [];
    const map = new Map<string, typeof scene.parts>();
    for (const part of scene.parts) {
      if (!map.has(part.group)) map.set(part.group, []);
      map.get(part.group)!.push(part);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [scene]);

  function pushUndo() {
    undoStack.current.push({
      hiddenGroups: new Set(hiddenGroups),
      hiddenInstances: new Set(hiddenInstances),
    });
  }

  function undo() {
    const prev = undoStack.current.pop();
    if (!prev) return;
    setHiddenGroups(prev.hiddenGroups);
    setHiddenInstances(prev.hiddenInstances);
  }

  function togglePartHidden(partId: string, count: number) {
    setHiddenInstances((prev) => {
      const next = new Set(prev);
      const allHidden = Array.from({ length: count }, (_, i) => `${partId}#${i}`).every((k) =>
        next.has(k),
      );
      for (let i = 0; i < count; i++) {
        const k = `${partId}#${i}`;
        if (allHidden) next.delete(k);
        else next.add(k);
      }
      return next;
    });
  }

  function deletePart(partId: string, count: number) {
    pushUndo();
    setHiddenInstances((prev) => {
      const next = new Set(prev);
      for (let i = 0; i < count; i++) next.add(`${partId}#${i}`);
      return next;
    });
    if (selected?.partId === partId) setSelected(null);
  }

  function deleteGroup(group: string) {
    pushUndo();
    setHiddenGroups((prev) => new Set(prev).add(group));
    if (selected?.group === group) setSelected(null);
  }

  const download = async () => {
    const blob = await api?.exportGlb();
    if (!blob) {
      setError("Export failed — the 3D engine could not package this scene.");
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(scene?.name ?? "model").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.glb`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const viewer = (
    <SceneViewer
      scene={scene}
      mode={mode}
      autoRotate={spin}
      explode={explode}
      hiddenGroups={hiddenGroups}
      hiddenInstances={hiddenInstances}
      selectedKey={selected?.key ?? null}
      onSelect={setSelected}
      groupOffsets={groupOffsets}
      onDragGroup={(group, offset) => setGroupOffsets((prev) => ({ ...prev, [group]: offset }))}
      moveMode={moveMode}
      onReady={setApi}
      className={
        full ? "absolute inset-0 size-full" : "relative h-[460px] w-full overflow-hidden rounded-xl"
      }
    />
  );

  const modeControls = (
    <div className="flex flex-wrap gap-2">
      {(["solid", "hologram", "blueprint"] as DisplayMode[]).map((m) => (
        <Button
          key={m}
          size="sm"
          variant={mode === m ? "default" : "outline"}
          onClick={() => setMode(m)}
          className="capitalize"
        >
          {m}
        </Button>
      ))}
      <Button size="sm" variant={spin ? "default" : "outline"} onClick={() => setSpin((v) => !v)}>
        <RotateCw className="mr-2 size-3.5" /> Spin
      </Button>
      <Button
        size="sm"
        variant={moveMode ? "default" : "outline"}
        onClick={() => setMoveMode((v) => !v)}
        disabled={!selected}
      >
        <Move className="mr-2 size-3.5" /> Move
      </Button>
      <Button size="sm" variant="outline" onClick={undo} disabled={!undoStack.current.length}>
        <Undo2 className="mr-2 size-3.5" /> Undo
      </Button>
      <Button size="sm" variant="outline" onClick={() => void download()} disabled={!scene}>
        <Download className="mr-2 size-3.5" /> .glb
      </Button>
    </div>
  );

  if (full) {
    return (
      <div className="fixed inset-0 z-50 bg-[#07070a]">
        {viewer}
        <div className="absolute right-5 top-5 z-10 flex flex-wrap justify-end gap-2">
          {modeControls}
          <Button size="sm" variant="outline" onClick={() => setFull(false)}>
            <Minimize2 className="mr-2 size-3.5" /> Exit
          </Button>
        </div>
        {scene ? (
          <p className="pointer-events-none absolute inset-x-0 bottom-5 text-center text-sm text-white/70">
            {scene.name} · {scene.parts.length} parts
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <Page eyebrow="3D" title="Studio" intro={description} wide>
      <div className="panel space-y-4 p-5">
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void run(prompt, Boolean(scene));
            }}
            placeholder={
              scene ? "Change it — e.g. add two more floors" : "Describe a building or object…"
            }
            disabled={busy}
          />
          <div className="flex gap-2">
            <Button onClick={() => void run(prompt, false)} disabled={busy || !prompt.trim()}>
              {busy ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <Box className="mr-2 size-4" />
              )}
              Build new
            </Button>
            {scene ? (
              <Button
                variant="outline"
                onClick={() => void run(prompt, true)}
                disabled={busy || !prompt.trim()}
              >
                Refine
              </Button>
            ) : null}
          </div>
        </div>

        {!scene && !busy ? (
          <div className="flex flex-wrap gap-2">
            {EXAMPLES.map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => void run(example, false)}
                className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground transition hover:text-foreground"
              >
                {example}
              </button>
            ))}
          </div>
        ) : null}

        {modeControls}

        {scene ? (
          <div className="flex items-center gap-3">
            <span className="label-mono shrink-0">Explode</span>
            <Slider
              value={[explode * 100]}
              onValueChange={([v]) => setExplode((v ?? 0) / 100)}
              max={100}
              step={1}
              className="max-w-xs"
            />
          </div>
        ) : null}

        {error ? <p className="text-sm leading-relaxed text-destructive">{error}</p> : null}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="panel relative overflow-hidden p-0">
          {viewer}
          <Button
            size="sm"
            variant="outline"
            onClick={() => setFull(true)}
            className="absolute right-4 top-4 z-10"
          >
            <Maximize2 className="mr-2 size-3.5" /> Fullscreen
          </Button>
        </div>

        <div className="space-y-4">
          {selected ? (
            <div className="panel p-4">
              <p className="label-mono">Selected part</p>
              <p className="mt-1.5 text-sm font-semibold">{selected.displayName}</p>
              <dl className="mt-3 space-y-1.5 text-xs text-muted-foreground">
                <div className="flex justify-between">
                  <dt>Dimensions (W×H×D)</dt>
                  <dd className="font-mono text-foreground">
                    {selected.dims.map((d) => d.toFixed(2)).join(" × ")} m
                  </dd>
                </div>
                {selected.volume != null ? (
                  <div className="flex justify-between">
                    <dt>Volume</dt>
                    <dd className="font-mono text-foreground">{selected.volume.toFixed(2)} m³</dd>
                  </div>
                ) : null}
                {selected.area != null ? (
                  <div className="flex justify-between">
                    <dt>Area</dt>
                    <dd className="font-mono text-foreground">{selected.area.toFixed(2)} m²</dd>
                  </div>
                ) : null}
                <div className="flex justify-between">
                  <dt>Material</dt>
                  <dd className="capitalize text-foreground">{selected.material}</dd>
                </div>
                <div className="flex justify-between">
                  <dt>Group</dt>
                  <dd className="text-foreground">{selected.group}</dd>
                </div>
                <div className="flex justify-between">
                  <dt>Position</dt>
                  <dd className="font-mono text-foreground">
                    {selected.position.map((p) => p.toFixed(2)).join(", ")}
                  </dd>
                </div>
              </dl>
              {moveMode ? (
                <p className="mt-3 text-[0.65rem] text-primary">
                  Drag the model to move this part's whole group.
                </p>
              ) : null}
            </div>
          ) : null}

          {scene ? (
            <div className="panel max-h-[28rem] overflow-y-auto p-4">
              <p className="label-mono">Outliner</p>
              <ul className="mt-3 space-y-1">
                {groups.map(([group, parts]) => {
                  const groupHidden = hiddenGroups.has(group);
                  const collapsed = collapsedGroups.has(group);
                  return (
                    <li key={group}>
                      <div className="flex items-center justify-between gap-1 rounded px-1 py-1 hover:bg-surface-2">
                        <button
                          className="flex min-w-0 flex-1 items-center gap-1 text-left text-xs font-semibold"
                          onClick={() =>
                            setCollapsedGroups((prev) => {
                              const next = new Set(prev);
                              if (next.has(group)) next.delete(group);
                              else next.add(group);
                              return next;
                            })
                          }
                        >
                          {collapsed ? (
                            <ChevronRight className="size-3 shrink-0" />
                          ) : (
                            <ChevronDown className="size-3 shrink-0" />
                          )}
                          <span className="truncate">{group}</span>
                          <span className="text-muted-foreground">({parts.length})</span>
                        </button>
                        <button
                          aria-label={`Toggle ${group} visibility`}
                          onClick={() =>
                            setHiddenGroups((p) => {
                              const next = new Set(p);
                              if (next.has(group)) next.delete(group);
                              else next.add(group);
                              return next;
                            })
                          }
                        >
                          {groupHidden ? (
                            <EyeOff className="size-3.5 text-muted-foreground" />
                          ) : (
                            <Eye className="size-3.5 text-muted-foreground" />
                          )}
                        </button>
                        <button aria-label={`Delete ${group}`} onClick={() => deleteGroup(group)}>
                          <Trash2 className="size-3.5 text-muted-foreground hover:text-destructive" />
                        </button>
                      </div>
                      {!collapsed ? (
                        <ul className="ml-4 space-y-0.5 border-l border-border pl-2">
                          {parts.map((part) => {
                            const count = part.repeat?.count ?? 1;
                            const partHidden = Array.from(
                              { length: count },
                              (_, i) => `${part.id}#${i}`,
                            ).every((k) => hiddenInstances.has(k));
                            return (
                              <li
                                key={part.id}
                                className={cn(
                                  "flex items-center justify-between gap-1 rounded px-1 py-0.5 text-[0.7rem]",
                                  selected?.partId === part.id
                                    ? "bg-primary/15 text-foreground"
                                    : "text-muted-foreground",
                                )}
                              >
                                <button
                                  className="min-w-0 flex-1 truncate text-left"
                                  onClick={() => {
                                    const { dims, volume, area } = dimsFromViewer(part);
                                    const offset = part.repeat?.offset ?? [0, 0, 0];
                                    const groupOffset = groupOffsets[part.group] ?? [0, 0, 0];
                                    setSelected({
                                      key: `${part.id}#0`,
                                      partId: part.id,
                                      instanceIndex: 0,
                                      displayName: count > 1 ? `${part.name} 1` : part.name,
                                      group: part.group,
                                      material: part.material,
                                      type: part.type,
                                      dims,
                                      position: [
                                        part.position[0] + offset[0] + groupOffset[0],
                                        part.position[1] + offset[1] + groupOffset[1],
                                        part.position[2] + offset[2] + groupOffset[2],
                                      ],
                                      volume,
                                      area,
                                    });
                                  }}
                                >
                                  {part.name}
                                  {count > 1 ? ` ×${count}` : ""}
                                </button>
                                <button
                                  aria-label={`Toggle ${part.name}`}
                                  onClick={() => togglePartHidden(part.id, count)}
                                >
                                  {partHidden ? (
                                    <EyeOff className="size-3 text-muted-foreground" />
                                  ) : (
                                    <Eye className="size-3 text-muted-foreground" />
                                  )}
                                </button>
                                <button
                                  aria-label={`Delete ${part.name}`}
                                  onClick={() => deletePart(part.id, count)}
                                >
                                  <Trash2 className="size-3 text-muted-foreground hover:text-destructive" />
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </div>
      </div>

      {scene ? (
        <div className="panel mt-4 space-y-1 p-5">
          <p className="label-mono">{scene.name}</p>
          <p className="text-sm leading-relaxed text-muted-foreground">{scene.description}</p>
          <p className="text-xs text-muted-foreground">
            {scene.parts.length} primitives · drag to orbit, scroll or pinch to zoom, tap to select
          </p>
        </div>
      ) : null}
    </Page>
  );
}

function dimsFromViewer(part: Scene3D["parts"][number]) {
  const [a, b, c] = part.size;
  switch (part.type) {
    case "cylinder":
    case "cone":
      return { dims: [a * 2, b, a * 2] as [number, number, number], volume: null, area: null };
    case "sphere":
      return { dims: [a * 2, a * 2, a * 2] as [number, number, number], volume: null, area: null };
    case "plane":
      return { dims: [a, 0, c] as [number, number, number], volume: null, area: a * c };
    default:
      return { dims: [a, b, c] as [number, number, number], volume: a * b * c, area: null };
  }
}
