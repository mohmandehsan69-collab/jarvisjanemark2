import { useEffect, useRef, useState } from "react";
import type { Scene3D, ScenePart } from "@/lib/scene3d.server";

/** Three.js is pulled from a CDN at runtime so the project needs no extra
 *  dependency install. Cached by the browser after the first load. */
const THREE_URL = "https://esm.sh/three@0.160.0";

type Props = { scene: Scene3D | null; className?: string };

export function SceneViewer({ scene, className }: Props) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<any>(null);
  const threeRef = useRef<any>(null);
  const groupRef = useRef<any>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState("");

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

        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x07070a);
        scene.fog = new THREE.Fog(0x07070a, 120, 600);

        const camera = new THREE.PerspectiveCamera(
          45,
          mount.clientWidth / Math.max(mount.clientHeight, 1),
          0.1,
          5000,
        );
        camera.position.set(28, 20, 34);

        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.setSize(mount.clientWidth, mount.clientHeight);
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        mount.appendChild(renderer.domElement);

        scene.add(new THREE.HemisphereLight(0xffffff, 0x2a2a35, 1.1));
        const key = new THREE.DirectionalLight(0xffd9a8, 2.1);
        key.position.set(40, 60, 30);
        key.castShadow = true;
        key.shadow.mapSize.set(1024, 1024);
        key.shadow.camera.left = -80;
        key.shadow.camera.right = 80;
        key.shadow.camera.top = 80;
        key.shadow.camera.bottom = -80;
        scene.add(key);
        const fill = new THREE.DirectionalLight(0x88aaff, 0.5);
        fill.position.set(-30, 25, -20);
        scene.add(fill);

        const ground = new THREE.Mesh(
          new THREE.PlaneGeometry(2000, 2000),
          new THREE.MeshStandardMaterial({ color: 0x14141c, roughness: 1, metalness: 0 }),
        );
        ground.rotation.x = -Math.PI / 2;
        ground.receiveShadow = true;
        scene.add(ground);

        const grid = new THREE.GridHelper(400, 80, 0xff6b1a, 0x2a2a33);
        (grid.material as any).opacity = 0.22;
        (grid.material as any).transparent = true;
        scene.add(grid);

        const group = new THREE.Group();
        scene.add(group);
        groupRef.current = group;
        sceneRef.current = { scene, camera, renderer };

        // Minimal orbit controls — avoids a second CDN import for OrbitControls.
        let dragging = false;
        let px = 0;
        let py = 0;
        let theta = Math.atan2(camera.position.x, camera.position.z);
        let phi = Math.acos(camera.position.y / camera.position.length());
        let radius = camera.position.length();
        const target = new THREE.Vector3(0, 4, 0);

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

        const el = renderer.domElement as HTMLCanvasElement;
        el.style.touchAction = "none";
        el.addEventListener("pointerdown", (e: PointerEvent) => {
          dragging = true;
          px = e.clientX;
          py = e.clientY;
          el.setPointerCapture(e.pointerId);
        });
        el.addEventListener("pointermove", (e: PointerEvent) => {
          if (!dragging) return;
          theta -= (e.clientX - px) * 0.006;
          phi -= (e.clientY - py) * 0.006;
          px = e.clientX;
          py = e.clientY;
          applyCamera();
        });
        el.addEventListener("pointerup", () => (dragging = false));
        el.addEventListener("pointercancel", () => (dragging = false));
        el.addEventListener(
          "wheel",
          (e: WheelEvent) => {
            e.preventDefault();
            radius = Math.max(3, Math.min(1200, radius * (1 + Math.sign(e.deltaY) * 0.12)));
            applyCamera();
          },
          { passive: false },
        );

        sceneRef.current.frame = (r: number) => {
          radius = Math.max(6, r * 2.6);
          target.set(0, r * 0.42, 0);
          applyCamera();
        };

        onResize = () => {
          if (!mount.clientWidth) return;
          camera.aspect = mount.clientWidth / Math.max(mount.clientHeight, 1);
          camera.updateProjectionMatrix();
          renderer.setSize(mount.clientWidth, mount.clientHeight);
        };
        window.addEventListener("resize", onResize);

        const tick = () => {
          renderer.render(scene, camera);
          raf = requestAnimationFrame(tick);
        };
        tick();
        setStatus("ready");
      } catch (err) {
        setStatus("error");
        setMessage(err instanceof Error ? err.message : "Could not load the 3D engine.");
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
  }, []);

  // Rebuild the mesh group whenever a new scene arrives.
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
      switch (part.type) {
        case "cylinder":
          return new THREE.CylinderGeometry(a, a, b, 32);
        case "cone":
          return new THREE.ConeGeometry(a, b, 32);
        case "sphere":
          return new THREE.SphereGeometry(a, 32, 24);
        case "torus":
          return new THREE.TorusGeometry(a, b, 16, 48);
        case "plane":
          return new THREE.PlaneGeometry(a, c);
        default:
          return new THREE.BoxGeometry(a, b, c);
      }
    };

    let maxExtent = 1;
    for (const part of scene.parts) {
      const geometry = geometryFor(part);
      const material = new THREE.MeshStandardMaterial({
        color: new THREE.Color(part.color ?? "#9aa3ad"),
        transparent: (part.opacity ?? 1) < 1,
        opacity: part.opacity ?? 1,
        metalness: part.metalness ?? 0.1,
        roughness: part.roughness ?? 0.75,
      });
      const count = part.repeat?.count ?? 1;
      const offset = part.repeat?.offset ?? [0, 0, 0];
      const mesh = new THREE.InstancedMesh(geometry, material, count);
      mesh.castShadow = true;
      mesh.receiveShadow = true;

      const dummy = new THREE.Object3D();
      const [rx, ry, rz] = part.rotation ?? [0, 0, 0];
      for (let i = 0; i < count; i++) {
        dummy.position.set(
          part.position[0] + offset[0] * i,
          part.position[1] + offset[1] * i,
          part.position[2] + offset[2] * i,
        );
        dummy.rotation.set(
          (rx * Math.PI) / 180,
          (ry * Math.PI) / 180,
          (rz * Math.PI) / 180,
        );
        if (part.type === "plane") dummy.rotation.x -= Math.PI / 2;
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        maxExtent = Math.max(
          maxExtent,
          Math.abs(dummy.position.x) + part.size[0],
          Math.abs(dummy.position.y) + part.size[1],
          Math.abs(dummy.position.z) + part.size[2],
        );
      }
      mesh.instanceMatrix.needsUpdate = true;
      group.add(mesh);
    }

    sceneRef.current?.frame?.(scene.boundsRadius && scene.boundsRadius > 1 ? scene.boundsRadius : maxExtent);
  }, [scene]);

  return (
    <div className={className ?? "relative size-full"}>
      <div ref={mountRef} className="size-full" />
      {status !== "ready" ? (
        <div className="absolute inset-0 flex items-center justify-center bg-[#07070a] text-sm text-white/60">
          {status === "loading" ? "Loading 3D engine…" : message}
        </div>
      ) : null}
      {status === "ready" && !scene ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-4 text-center text-xs text-white/40">
          Drag to orbit · scroll to zoom
        </div>
      ) : null}
    </div>
  );
}
