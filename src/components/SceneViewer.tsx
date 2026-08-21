import { useEffect, useRef } from "react";
import type { Scene3D, ScenePart } from "@/lib/scene3d.server";

/** Three.js is pulled from a CDN at runtime so the project needs no extra
 *  dependency install. Cached by the browser after the first load. */
const THREE_URL = "https://esm.sh/three@0.160.0";

export type DisplayMode = "solid" | "hologram" | "blueprint";

export type SelectionInfo = {
  key: string;
  partId: string;
  instanceIndex: number;
  displayName: string;
  group: string;
  material: string;
  type: ScenePart["type"];
  dims: [number, number, number];
  position: [number, number, number];
  volume: number | null;
  area: number | null;
};

export type ViewerApi = {
  exportGlb: () => Promise<Blob | null>;
  frame: () => void;
};

type Props = {
  scene: Scene3D | null;
  className?: string;
  mode: DisplayMode;
  autoRotate?: boolean;
  /** 0 (stacked as designed) .. 1 (storeys/groups pulled fully apart). */
  explode: number;
  hiddenGroups: Set<string>;
  /** Individually hidden/deleted instances, keyed "<partId>#<instanceIndex>". */
  hiddenInstances: Set<string>;
  selectedKey: string | null;
  onSelect: (info: SelectionInfo | null) => void;
  groupOffsets: Record<string, [number, number, number]>;
  onDragGroup: (group: string, offset: [number, number, number]) => void;
  moveMode: boolean;
  onReady?: (api: ViewerApi) => void;
};

const EXPLODE_SPACING = 2.2;

function dimsAndVolume(part: ScenePart): {
  dims: [number, number, number];
  volume: number | null;
  area: number | null;
} {
  const [a, b, c] = part.size;
  switch (part.type) {
    case "cylinder":
      return { dims: [a * 2, b, a * 2], volume: Math.PI * a * a * b, area: null };
    case "cone":
      return { dims: [a * 2, b, a * 2], volume: (Math.PI * a * a * b) / 3, area: null };
    case "sphere":
      return { dims: [a * 2, a * 2, a * 2], volume: (4 / 3) * Math.PI * a ** 3, area: null };
    case "torus":
      return {
        dims: [(a + b) * 2, b * 2, (a + b) * 2],
        volume: 2 * Math.PI ** 2 * a * b * b,
        area: null,
      };
    case "plane":
      return { dims: [a, 0, c], volume: null, area: a * c };
    case "prism":
      return { dims: [a * 2, b, c], volume: 0.5 * (a * 2) * b * c, area: null };
    case "pyramid":
      return { dims: [a * 2, b, a * 2], volume: (a * 2 * (a * 2) * b) / 3, area: null };
    default:
      return { dims: [a, b, c], volume: a * b * c, area: null };
  }
}

export function SceneViewer({
  scene,
  className,
  mode,
  autoRotate = false,
  explode,
  hiddenGroups,
  hiddenInstances,
  selectedKey,
  onSelect,
  groupOffsets,
  onDragGroup,
  moveMode,
  onReady,
}: Props) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<any>(null);
  const threeRef = useRef<any>(null);
  const groupRef = useRef<any>(null);
  const highlightRef = useRef<any>(null);
  const statusRef = useRef<HTMLDivElement | null>(null);

  const propsRef = useRef({
    mode,
    explode,
    hiddenGroups,
    hiddenInstances,
    groupOffsets,
    selectedKey,
    moveMode,
  });
  propsRef.current = {
    mode,
    explode,
    hiddenGroups,
    hiddenInstances,
    groupOffsets,
    selectedKey,
    moveMode,
  };
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onDragGroupRef = useRef(onDragGroup);
  onDragGroupRef.current = onDragGroup;

  // One-time engine setup: renderer, camera, lights, ground, orbit controls.
  useEffect(() => {
    let disposed = false;
    let raf = 0;
    let renderer: any;
    let onResize: (() => void) | null = null;

    (async () => {
      try {
        const THREE = await import(/* @vite-ignore */ THREE_URL);
        if (disposed) return;
        threeRef.current = THREE;
        const mount = mountRef.current;
        if (!mount) return;

        const scn = new THREE.Scene();
        scn.background = new THREE.Color(0x07070a);
        scn.fog = new THREE.Fog(0x07070a, 120, 600);

        const camera = new THREE.PerspectiveCamera(
          45,
          mount.clientWidth / Math.max(mount.clientHeight, 1),
          0.1,
          5000,
        );
        camera.position.set(28, 20, 34);

        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
        const isSmall = mount.clientWidth < 700;
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isSmall ? 1.5 : 2));
        renderer.setSize(mount.clientWidth, mount.clientHeight);
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.05;
        mount.appendChild(renderer.domElement);

        const hemi = new THREE.HemisphereLight(0xffffff, 0x2a2a35, 1.1);
        scn.add(hemi);
        const key = new THREE.DirectionalLight(0xffd9a8, 2.1);
        key.position.set(40, 60, 30);
        key.castShadow = true;
        key.shadow.mapSize.set(1024, 1024);
        key.shadow.camera.near = 1;
        key.shadow.camera.far = 4000;
        scn.add(key);
        scn.add(key.target);
        const fill = new THREE.DirectionalLight(0x88aaff, 0.5);
        fill.position.set(-30, 25, -20);
        scn.add(fill);

        const ground = new THREE.Mesh(
          new THREE.PlaneGeometry(2000, 2000),
          new THREE.MeshStandardMaterial({ color: 0x14141c, roughness: 1, metalness: 0 }),
        );
        ground.rotation.x = -Math.PI / 2;
        ground.receiveShadow = true;
        scn.add(ground);

        const grid = new THREE.GridHelper(400, 80, 0xff6b1a, 0x2a2a33);
        grid.material.opacity = 0.22;
        grid.material.transparent = true;
        scn.add(grid);

        const scanPlane = new THREE.Mesh(
          new THREE.PlaneGeometry(400, 400),
          new THREE.MeshBasicMaterial({
            color: 0xffc766,
            transparent: true,
            opacity: 0,
            side: THREE.DoubleSide,
          }),
        );
        scanPlane.rotation.x = -Math.PI / 2;
        scn.add(scanPlane);

        const group = new THREE.Group();
        scn.add(group);
        groupRef.current = group;

        const highlight = new THREE.Box3Helper(new THREE.Box3(), new THREE.Color(0xffc766));
        highlight.visible = false;
        scn.add(highlight);
        highlightRef.current = highlight;

        sceneRef.current = { scene: scn, camera, renderer, grid, scanPlane, ground };

        // Orbit + pinch/pan controls (single pointer orbits, two-finger touch
        // pinches to zoom and pans; move-mode drags the selected group instead).
        let dragging = false;
        let dragMode: "orbit" | "move" | "pan" = "orbit";
        let px = 0;
        let py = 0;
        let theta = Math.atan2(camera.position.x, camera.position.z);
        let phi = Math.acos(camera.position.y / camera.position.length());
        let radius = camera.position.length();
        const target = new THREE.Vector3(0, 4, 0);
        const pointers = new Map<number, { x: number; y: number }>();
        let pinchStartDist = 0;
        let pinchStartRadius = 0;
        let moveGroupKey: string | null = null;
        let movePlane = new THREE.Plane();
        let moveStart = new THREE.Vector3();
        let moveBaseOffset: [number, number, number] = [0, 0, 0];

        const applyCamera = () => {
          phi = Math.max(0.12, Math.min(Math.PI / 2 - 0.02, phi));
          camera.position.set(
            target.x + radius * Math.sin(phi) * Math.sin(theta),
            target.y + radius * Math.cos(phi),
            target.z + radius * Math.sin(phi) * Math.cos(theta),
          );
          camera.lookAt(target);
        };
        applyCamera();

        const raycaster = new THREE.Raycaster();
        const pointerNdc = new THREE.Vector2();

        function pickAt(clientX: number, clientY: number) {
          const rect = el.getBoundingClientRect();
          pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
          pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
          raycaster.setFromCamera(pointerNdc, camera);
          const hits = raycaster.intersectObjects(group.children, false);
          return hits.find((h: any) => h.object.visible && h.object.userData?.part) ?? null;
        }

        const el = renderer.domElement as HTMLCanvasElement;
        el.style.touchAction = "none";

        el.addEventListener("pointerdown", (e: PointerEvent) => {
          pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
          el.setPointerCapture(e.pointerId);
          if (pointers.size === 1) {
            px = e.clientX;
            py = e.clientY;
            dragging = true;
            dragMode = "orbit";
            if (propsRef.current.moveMode && propsRef.current.selectedKey) {
              const hit = pickAt(e.clientX, e.clientY);
              const key = hit ? `${hit.object.userData.part.id}#${hit.instanceId ?? 0}` : null;
              if (key === propsRef.current.selectedKey) {
                dragMode = "move";
                moveGroupKey = hit!.object.userData.part.group as string;
                const normal = new THREE.Vector3().subVectors(camera.position, target).normalize();
                movePlane.setFromNormalAndCoplanarPoint(normal, hit!.point);
                moveStart = hit!.point.clone();
                moveBaseOffset = propsRef.current.groupOffsets[moveGroupKey] ?? [0, 0, 0];
              }
            }
          } else if (pointers.size === 2) {
            dragging = false;
            const pts = [...pointers.values()];
            pinchStartDist = Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y);
            pinchStartRadius = radius;
          }
        });

        el.addEventListener("pointermove", (e: PointerEvent) => {
          if (!pointers.has(e.pointerId)) return;
          pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

          if (pointers.size === 2) {
            const pts = [...pointers.values()];
            const dist = Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y);
            if (pinchStartDist > 0) {
              radius = Math.max(
                3,
                Math.min(1200, pinchStartRadius * (pinchStartDist / Math.max(dist, 1))),
              );
              applyCamera();
            }
            return;
          }

          if (!dragging) return;
          const dx = e.clientX - px;
          const dy = e.clientY - py;
          px = e.clientX;
          py = e.clientY;

          if (dragMode === "move" && moveGroupKey) {
            const rect = el.getBoundingClientRect();
            pointerNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
            pointerNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
            raycaster.setFromCamera(pointerNdc, camera);
            const hitPoint = new THREE.Vector3();
            if (raycaster.ray.intersectPlane(movePlane, hitPoint)) {
              const delta = hitPoint.clone().sub(moveStart);
              const next: [number, number, number] = [
                moveBaseOffset[0] + delta.x,
                moveBaseOffset[1] + delta.y,
                moveBaseOffset[2] + delta.z,
              ];
              onDragGroupRef.current(moveGroupKey, next);
            }
            return;
          }

          theta -= dx * 0.006;
          phi -= dy * 0.006;
          applyCamera();
        });

        function endPointer(e: PointerEvent) {
          const start = pointers.get(e.pointerId);
          pointers.delete(e.pointerId);
          if (pointers.size === 0) {
            const moved = start ? Math.hypot(e.clientX - start.x, e.clientY - start.y) : 999;
            if (dragMode !== "move" && moved < 6) {
              const hit = pickAt(e.clientX, e.clientY);
              if (hit) {
                const part = hit.object.userData.part as ScenePart;
                const instanceIndex = hit.instanceId ?? 0;
                const count = part.repeat?.count ?? 1;
                const offset = part.repeat?.offset ?? [0, 0, 0];
                const groupOffset = propsRef.current.groupOffsets[part.group] ?? [0, 0, 0];
                const explodeY = explodeOffsetFor(part.group, propsRef.current.explode);
                const worldPos: [number, number, number] = [
                  part.position[0] + offset[0] * instanceIndex + groupOffset[0],
                  part.position[1] + offset[1] * instanceIndex + groupOffset[1] + explodeY,
                  part.position[2] + offset[2] * instanceIndex + groupOffset[2],
                ];
                const { dims, volume, area } = dimsAndVolume(part);
                onSelectRef.current({
                  key: `${part.id}#${instanceIndex}`,
                  partId: part.id,
                  instanceIndex,
                  displayName: count > 1 ? `${part.name} ${instanceIndex + 1}` : part.name,
                  group: part.group,
                  material: part.material,
                  type: part.type,
                  dims,
                  position: worldPos,
                  volume,
                  area,
                });
              } else {
                onSelectRef.current(null);
              }
            }
            dragging = false;
            dragMode = "orbit";
            moveGroupKey = null;
          }
        }
        el.addEventListener("pointerup", endPointer);
        el.addEventListener("pointercancel", endPointer);

        el.addEventListener(
          "wheel",
          (e: WheelEvent) => {
            e.preventDefault();
            radius = Math.max(3, Math.min(1200, radius * (1 + Math.sign(e.deltaY) * 0.12)));
            applyCamera();
          },
          { passive: false },
        );

        sceneRef.current.frameBox = (box: any) => {
          if (!box || box.isEmpty()) return;
          const size = box.getSize(new THREE.Vector3());
          const centre = box.getCenter(new THREE.Vector3());
          const extent = Math.max(size.x, size.y, size.z, 1);
          const fitDistance = extent / (2 * Math.tan((camera.fov * Math.PI) / 360));
          radius = Math.max(4, fitDistance * 1.75);
          target.copy(centre);
          camera.near = Math.max(0.05, radius / 500);
          camera.far = radius * 40;
          camera.updateProjectionMatrix();

          const s = extent * 0.85;
          key.shadow.camera.left = -s;
          key.shadow.camera.right = s;
          key.shadow.camera.top = s;
          key.shadow.camera.bottom = -s;
          key.position.set(centre.x + extent, centre.y + extent * 1.4, centre.z + extent * 0.8);
          key.target.position.copy(centre);
          key.target.updateMatrixWorld();
          key.shadow.camera.updateProjectionMatrix();

          grid.position.set(centre.x, 0, centre.z);
          applyCamera();
        };
        sceneRef.current.setAutoRotate = (on: boolean) => {
          sceneRef.current.autoRotate = on;
        };

        onResize = () => {
          if (!mount.clientWidth) return;
          camera.aspect = mount.clientWidth / Math.max(mount.clientHeight, 1);
          camera.updateProjectionMatrix();
          renderer.setSize(mount.clientWidth, mount.clientHeight);
        };
        window.addEventListener("resize", onResize);

        const tick = (t: number) => {
          if (sceneRef.current?.autoRotate && !dragging) {
            theta += 0.0022;
            applyCamera();
          }
          if (propsRef.current.mode === "hologram") {
            const y = ((Math.sin(t / 1400) + 1) / 2) * 30 - 5;
            scanPlane.position.y = y;
            scanPlane.material.opacity = 0.06;
          } else {
            scanPlane.material.opacity = 0;
          }
          renderer.render(scn, camera);
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);

        onReady?.({
          exportGlb: async () => {
            try {
              const gltfExporterUrl =
                "https://esm.sh/three@0.160.0/examples/jsm/exporters/GLTFExporter.js";
              const mod = await import(/* @vite-ignore */ gltfExporterUrl);
              const exporter = new mod.GLTFExporter();
              const target2 = groupRef.current;
              if (!target2) return null;
              const buffer: ArrayBuffer = await new Promise((resolve, reject) =>
                exporter.parse(target2, resolve, reject, { binary: true }),
              );
              return new Blob([buffer], { type: "model/gltf-binary" });
            } catch {
              return null;
            }
          },
          frame: () => {
            const box = new THREE.Box3().setFromObject(groupRef.current);
            sceneRef.current?.frameBox?.(box);
          },
        });
      } catch (err) {
        if (statusRef.current) {
          statusRef.current.textContent =
            err instanceof Error ? err.message : "Could not load the 3D engine.";
          statusRef.current.style.display = "flex";
        }
      }
    })();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      if (onResize) window.removeEventListener("resize", onResize);
      try {
        renderer?.dispose?.();
        renderer?.domElement?.remove();
      } catch {
        /* noop */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function explodeOffsetFor(group: string, explodeAmount: number): number {
    if (!explodeAmount) return 0;
    // Order groups by name so storeys separate in a stable, readable order.
    const groups = [...new Set((scene?.parts ?? []).map((p) => p.group))].sort();
    const idx = groups.indexOf(group);
    return idx * EXPLODE_SPACING * explodeAmount;
  }

  // Rebuild the mesh group whenever the scene or any interactive state changes.
  useEffect(() => {
    const THREE = threeRef.current;
    const group = groupRef.current;
    if (!THREE || !group || !scene) return;

    while (group.children.length) {
      const child = group.children.pop();
      child.geometry?.dispose?.();
      child.material?.dispose?.();
    }

    const geometryFor = (part: ScenePart) => {
      const [a, b, c] = part.size;
      const taper = part.taper ?? 1;
      switch (part.type) {
        case "cylinder":
          return new THREE.CylinderGeometry(a * taper, a, b, 32);
        case "cone":
          return new THREE.ConeGeometry(a, b, 32);
        case "sphere":
          return new THREE.SphereGeometry(a, 32, 24);
        case "torus":
          return new THREE.TorusGeometry(a, b, 16, 48);
        case "plane":
          return new THREE.PlaneGeometry(a, c);
        case "pyramid":
          return new THREE.ConeGeometry(a * Math.SQRT2, b, 4).rotateY(Math.PI / 4);
        case "prism": {
          const g = new THREE.CylinderGeometry(a, a, c, 3);
          g.rotateX(Math.PI / 2);
          g.rotateZ(Math.PI / 2);
          g.scale(1, b / a, 1);
          return g;
        }
        default:
          return new THREE.BoxGeometry(a, b, c);
      }
    };

    const materialFor = (part: ScenePart) => {
      const colour = new THREE.Color(part.color ?? "#9aa3ad");
      if (mode === "blueprint") {
        return new THREE.MeshBasicMaterial({ color: 0x2a3542, transparent: true, opacity: 0.55 });
      }
      if (mode === "hologram") {
        return new THREE.MeshBasicMaterial({
          color: 0xffb066,
          transparent: true,
          opacity: 0.16,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        });
      }
      const glow = part.emissive ?? 0;
      return new THREE.MeshStandardMaterial({
        color: colour,
        transparent: (part.opacity ?? 1) < 1,
        opacity: part.opacity ?? 1,
        metalness: part.metalness ?? 0.1,
        roughness: part.roughness ?? 0.75,
        emissive: glow > 0 ? colour.clone() : new THREE.Color(0x000000),
        emissiveIntensity: glow,
      });
    };

    const bounds = new THREE.Box3();
    const byVolume: { part: ScenePart; volume: number }[] = [];

    for (const part of scene.parts) {
      if (hiddenGroups.has(part.group)) continue;
      const count = part.repeat?.count ?? 1;
      const offset = part.repeat?.offset ?? [0, 0, 0];
      const visibleIndices: number[] = [];
      for (let i = 0; i < count; i++) {
        if (!hiddenInstances.has(`${part.id}#${i}`)) visibleIndices.push(i);
      }
      if (!visibleIndices.length) continue;

      const geometry = geometryFor(part);
      const material = materialFor(part);
      const mesh = new THREE.InstancedMesh(geometry, material, visibleIndices.length);
      mesh.castShadow = mode === "solid";
      mesh.receiveShadow = mode === "solid";
      mesh.userData.part = part;

      const groupOffset = groupOffsets[part.group] ?? [0, 0, 0];
      const explodeY = explodeOffsetFor(part.group, explode);
      const dummy = new THREE.Object3D();
      const [rx, ry, rz] = part.rotation ?? [0, 0, 0];
      visibleIndices.forEach((i, slot) => {
        const px = part.position[0] + offset[0] * i + groupOffset[0];
        const py = part.position[1] + offset[1] * i + groupOffset[1] + explodeY;
        const pz = part.position[2] + offset[2] * i + groupOffset[2];
        dummy.position.set(px, py, pz);
        dummy.rotation.set((rx * Math.PI) / 180, (ry * Math.PI) / 180, (rz * Math.PI) / 180);
        if (part.type === "plane") dummy.rotation.x -= Math.PI / 2;
        dummy.updateMatrix();
        mesh.setMatrixAt(slot, dummy.matrix);
        const half = new THREE.Vector3(part.size[0], part.size[1], part.size[2]);
        bounds.expandByPoint(dummy.position.clone().sub(half));
        bounds.expandByPoint(dummy.position.clone().add(half));
      });
      mesh.instanceMatrix.needsUpdate = true;
      group.add(mesh);
      byVolume.push({
        part,
        volume: part.size[0] * part.size[1] * part.size[2] * visibleIndices.length,
      });

      const wantsEdges = mode !== "hologram" || true;
      if (
        wantsEdges &&
        visibleIndices.length <= 80 &&
        part.type !== "sphere" &&
        part.type !== "torus"
      ) {
        const edgeColor =
          mode === "hologram" ? 0xffc766 : mode === "blueprint" ? 0xffffff : 0x000000;
        const edgeOpacity = mode === "hologram" ? 0.9 : mode === "blueprint" ? 0.5 : 0.22;
        const outline = new THREE.LineSegments(
          new THREE.EdgesGeometry(geometry, 25),
          new THREE.LineBasicMaterial({
            color: edgeColor,
            transparent: true,
            opacity: edgeOpacity,
          }),
        );
        const holder = new THREE.Group();
        visibleIndices.forEach((i) => {
          const clone = outline.clone();
          clone.position.set(
            part.position[0] + offset[0] * i + groupOffset[0],
            part.position[1] + offset[1] * i + groupOffset[1] + explodeY,
            part.position[2] + offset[2] * i + groupOffset[2],
          );
          clone.rotation.set((rx * Math.PI) / 180, (ry * Math.PI) / 180, (rz * Math.PI) / 180);
          if (part.type === "plane") clone.rotation.x -= Math.PI / 2;
          holder.add(clone);
        });
        group.add(holder);
      }
    }

    // Hologram/blueprint: glowing vertex dots + floating labels on the
    // largest parts, so the model reads as data even before you click it.
    if (mode !== "solid") {
      byVolume.sort((a, b) => b.volume - a.volume);
      const top = byVolume.slice(0, 6);
      const dotPositions: number[] = [];
      for (const { part } of top) {
        const groupOffset = groupOffsets[part.group] ?? [0, 0, 0];
        const explodeY = explodeOffsetFor(part.group, explode);
        const [hx, hy, hz] = [part.size[0] / 2, part.size[1] / 2, part.size[2] / 2];
        for (const sx of [-1, 1]) {
          for (const sy of [-1, 1]) {
            for (const sz of [-1, 1]) {
              dotPositions.push(
                part.position[0] + groupOffset[0] + sx * hx,
                part.position[1] + groupOffset[1] + explodeY + sy * hy,
                part.position[2] + groupOffset[2] + sz * hz,
              );
            }
          }
        }
      }
      if (dotPositions.length) {
        const dotGeo = new THREE.BufferGeometry();
        dotGeo.setAttribute("position", new THREE.Float32BufferAttribute(dotPositions, 3));
        const dotMat = new THREE.PointsMaterial({
          color: mode === "hologram" ? 0xffc766 : 0xffffff,
          size: 0.12,
          sizeAttenuation: true,
          transparent: true,
          opacity: 0.85,
        });
        group.add(new THREE.Points(dotGeo, dotMat));
      }

      // Floating text labels via small canvas sprites — no extra CDN import.
      const overlay = overlayRef.current;
      if (overlay) overlay.innerHTML = "";
      for (const { part } of top.slice(0, 5)) {
        const { dims } = dimsAndVolume(part);
        const label = `${part.name} · ${dims[0].toFixed(1)}×${dims[1].toFixed(1)}×${dims[2].toFixed(1)}m`;
        const groupOffset = groupOffsets[part.group] ?? [0, 0, 0];
        const explodeY = explodeOffsetFor(part.group, explode);
        const worldPos = new THREE.Vector3(
          part.position[0] + groupOffset[0],
          part.position[1] + groupOffset[1] + explodeY + part.size[1] / 2 + 0.4,
          part.position[2] + groupOffset[2],
        );
        const sprite = makeLabelSprite(THREE, label, mode === "hologram" ? "#ffc766" : "#ffffff");
        sprite.position.copy(worldPos);
        group.add(sprite);
      }
    }

    sceneRef.current?.frameBox?.(bounds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, mode, explode, hiddenGroups, hiddenInstances, groupOffsets]);

  // Selection highlight box.
  useEffect(() => {
    const THREE = threeRef.current;
    const highlight = highlightRef.current;
    const group = groupRef.current;
    if (!THREE || !highlight || !group || !scene) return;
    if (!selectedKey) {
      highlight.visible = false;
      return;
    }
    const [partId, instanceStr] = selectedKey.split("#");
    const part = scene.parts.find((p) => p.id === partId);
    if (!part) {
      highlight.visible = false;
      return;
    }
    const i = Number(instanceStr ?? 0);
    const offset = part.repeat?.offset ?? [0, 0, 0];
    const groupOffset = groupOffsets[part.group] ?? [0, 0, 0];
    const explodeY = explodeOffsetFor(part.group, explode);
    const centre = new THREE.Vector3(
      part.position[0] + offset[0] * i + groupOffset[0],
      part.position[1] + offset[1] * i + groupOffset[1] + explodeY,
      part.position[2] + offset[2] * i + groupOffset[2],
    );
    const half = new THREE.Vector3(
      part.size[0] / 2 + 0.03,
      part.size[1] / 2 + 0.03,
      part.size[2] / 2 + 0.03,
    );
    const box = new THREE.Box3(centre.clone().sub(half), centre.clone().add(half));
    highlight.box.copy(box);
    highlight.visible = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey, scene, groupOffsets, explode]);

  useEffect(() => {
    sceneRef.current?.setAutoRotate?.(autoRotate);
  }, [autoRotate]);

  return (
    <div className={className ?? "relative size-full"}>
      <div ref={mountRef} className="size-full" />
      <div ref={overlayRef} className="pointer-events-none absolute inset-0" />
      {mode === "hologram" ? (
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.06]"
          style={{
            backgroundImage:
              "repeating-linear-gradient(0deg, #ffb066 0px, #ffb066 1px, transparent 1px, transparent 3px)",
          }}
        />
      ) : null}
      <div
        ref={statusRef}
        style={{ display: "none" }}
        className="absolute inset-0 items-center justify-center bg-[#07070a] text-sm text-white/60"
      >
        Loading 3D engine…
      </div>
      {!scene ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-4 text-center text-xs text-white/40">
          Drag to orbit · scroll or pinch to zoom · tap a part to select it
        </div>
      ) : null}
    </div>
  );
}

function makeLabelSprite(THREE: any, text: string, color: string) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  const scale = 2;
  ctx.font = `${13 * scale}px ui-monospace, monospace`;
  const width = ctx.measureText(text).width + 16 * scale;
  canvas.width = width;
  canvas.height = 22 * scale;
  ctx.font = `${13 * scale}px ui-monospace, monospace`;
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = color;
  ctx.textBaseline = "middle";
  ctx.fillText(text, 8 * scale, canvas.height / 2);
  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set((canvas.width / canvas.height) * 0.6, 0.6, 1);
  return sprite;
}
