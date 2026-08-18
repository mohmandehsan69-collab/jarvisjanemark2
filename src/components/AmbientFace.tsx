import { useEffect, useRef } from "react";

export type AmbientPhase = "idle" | "listening" | "thinking" | "speaking";

type Props = {
  phase: AmbientPhase;
  active: boolean;
  className?: string;
};

const GLYPHS = [
  "SYS.OK",
  "0x4F2A",
  "AMP 0.62",
  "LNK ▮▮▯",
  "TRK 04",
  "Δ 12.7",
  "PWR 98%",
  "SEQ//09",
];

/** One filament: a curved strand lying on the sphere shell. */
type Strand = {
  /** inclination of the great-circle plane */
  tilt: number;
  /** rotation of that plane about the polar axis */
  yaw: number;
  /** where along the circle the strand starts */
  start: number;
  /** angular length of the strand */
  span: number;
  /** shell radius factor (layering) */
  shell: number;
  /** per-strand undulation phase + speed */
  phase: number;
  speed: number;
  wobble: number;
};

function buildStrands(count: number): Strand[] {
  const out: Strand[] = [];
  for (let i = 0; i < count; i++) {
    // Golden-angle distribution keeps planes from clumping.
    const g = i * 2.399963;
    out.push({
      tilt: Math.acos(1 - (2 * (i + 0.5)) / count),
      yaw: g,
      start: (g * 1.7) % (Math.PI * 2),
      span: 1.1 + ((i * 37) % 100) / 100 * 2.4,
      shell: 0.78 + ((i * 53) % 100) / 100 * 0.22,
      phase: ((i * 71) % 100) / 100 * Math.PI * 2,
      speed: 0.6 + ((i * 29) % 100) / 100 * 1.1,
      wobble: 0.012 + ((i * 17) % 100) / 100 * 0.05,
    });
  }
  return out;
}

/** Amber volumetric hologram. Canvas + rAF, driven by the voice phase. */
export function AmbientFace({ phase, active, className }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const phaseRef = useRef(phase);
  const activeRef = useRef(active);
  phaseRef.current = phase;
  activeRef.current = active;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let disposed = false;
    let audioCtx: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    let stream: MediaStream | null = null;
    let freq: Uint8Array | null = null;
    let amp = 0;
    let smoothAmp = 0;
    let micRequested = false;

    const dpr = Math.min(typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1, 2);

    // Fewer strands on small/low-dpr screens keeps phones smooth.
    const isSmall = typeof window !== "undefined" && window.innerWidth < 700;
    const STRAND_COUNT = isSmall ? 130 : 260;
    const SEGMENTS = isSmall ? 14 : 22;
    const strands = buildStrands(STRAND_COUNT);

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
    };
    resize();
    window.addEventListener("resize", resize);

    const openMic = async () => {
      if (micRequested || typeof navigator === "undefined" || !navigator.mediaDevices) return;
      micRequested = true;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const Ctor = window.AudioContext ?? (window as any).webkitAudioContext;
        audioCtx = new Ctor();
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.75;
        audioCtx.createMediaStreamSource(stream).connect(analyser);
        freq = new Uint8Array(analyser.frequencyBinCount);
      } catch {
        analyser = null; // Visual falls back to synthetic motion.
      }
    };

    const readAmp = () => {
      if (!analyser || !freq) return 0;
      analyser.getByteFrequencyData(freq as any);
      let sum = 0;
      for (let i = 0; i < freq.length; i++) sum += freq[i]!;
      return Math.min(1, sum / freq.length / 110);
    };

    // Reusable point buffer to avoid per-frame allocation.
    const px = new Float32Array(SEGMENTS + 1);
    const py = new Float32Array(SEGMENTS + 1);
    const pz = new Float32Array(SEGMENTS + 1);

    const draw = (t: number) => {
      if (disposed) return;
      const w = canvas.width;
      const h = canvas.height;
      const cx = w / 2;
      const cy = h / 2;
      const R = (Math.min(w, h) / 2) * 0.82;
      const ph = phaseRef.current;
      const on = activeRef.current;
      const time = t / 1000;

      if (ph === "listening") void openMic();
      amp = ph === "listening" ? readAmp() : 0;
      smoothAmp += (amp - smoothAmp) * 0.18;

      const breath = 0.5 + 0.5 * Math.sin(time * 1.1);
      const base = ph === "idle" || !on ? 0.36 + breath * 0.12 : 0.85;

      // Rotation speed + shell scale per phase.
      const spin =
        ph === "thinking" ? 0.85 : ph === "speaking" ? 0.4 : ph === "listening" ? 0.28 : 0.16;
      // THINKING pulls strands inward, LISTENING pushes them out with volume.
      const contract =
        ph === "thinking"
          ? 0.82 + Math.sin(time * 3) * 0.03
          : ph === "listening"
            ? 1 + smoothAmp * 0.22
            : ph === "speaking"
              ? 1 + Math.sin(time * 5) * 0.035
              : 1 + breath * 0.02;

      const rotY = time * spin;
      const rotX = 0.42 + Math.sin(time * 0.21) * 0.12; // tilted axis

      const cosY = Math.cos(rotY);
      const sinY = Math.sin(rotY);
      const cosX = Math.cos(rotX);
      const sinX = Math.sin(rotX);

      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = "#07070a";
      ctx.fillRect(0, 0, w, h);

      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.lineCap = "round";

      // Depth sort strands back-to-front by their mid-point z.
      const order: { s: Strand; z: number }[] = [];
      for (const s of strands) {
        const a = s.start + s.span / 2;
        // point on great circle in local space
        const lx = Math.cos(a);
        const ly = Math.sin(a) * Math.cos(s.tilt);
        const lz = Math.sin(a) * Math.sin(s.tilt);
        // yaw about Y then global rotation
        const yx = lx * Math.cos(s.yaw) + lz * Math.sin(s.yaw);
        const yz = -lx * Math.sin(s.yaw) + lz * Math.cos(s.yaw);
        const rx2 = yx * cosY + yz * sinY;
        const rz2 = -yx * sinY + yz * cosY;
        const rz3 = ly * sinX + rz2 * cosX;
        order.push({ s, z: rz3 });
      }
      order.sort((a, b) => a.z - b.z);

      for (const { s } of order) {
        const shell = R * s.shell * contract;
        // Undulation travels along the strand so the surface never sits still.
        const flow = time * s.speed + s.phase;

        for (let i = 0; i <= SEGMENTS; i++) {
          const u = i / SEGMENTS;
          const a = s.start + s.span * u;
          const ripple = 1 + Math.sin(flow + u * 6.2) * s.wobble;
          const rr = shell * ripple;

          const lx = Math.cos(a) * rr;
          const ly = Math.sin(a) * Math.cos(s.tilt) * rr;
          const lz = Math.sin(a) * Math.sin(s.tilt) * rr;

          const yx = lx * Math.cos(s.yaw) + lz * Math.sin(s.yaw);
          const yz = -lx * Math.sin(s.yaw) + lz * Math.cos(s.yaw);

          const rx2 = yx * cosY + yz * sinY;
          const rz2 = -yx * sinY + yz * cosY;
          const ry3 = ly * cosX - rz2 * sinX;
          const rz3 = ly * sinX + rz2 * cosX;

          // Perspective: nearer strands read slightly larger.
          const persp = 1 / (1 - rz3 / (R * 4.2));
          px[i] = cx + rx2 * persp;
          py[i] = cy + ry3 * persp;
          pz[i] = rz3;
        }

        // Depth -> opacity and colour temperature (hot core, cool amber shell).
        const zMid = pz[SEGMENTS >> 1]!;
        const depth = (zMid / R + 1) / 2; // 0 back, 1 front
        const alpha = (0.06 + depth * 0.5) * base;
        const heat = 1 - s.shell; // inner shells run hotter/whiter
        const rC = 255;
        const gC = Math.round(120 + heat * 120 + depth * 40);
        const bC = Math.round(30 + heat * 130 * depth);

        ctx.strokeStyle = `rgba(${rC},${gC},${bC},${alpha})`;
        ctx.lineWidth = (0.5 + depth * 1.1) * dpr;
        ctx.beginPath();
        ctx.moveTo(px[0]!, py[0]!);
        for (let i = 1; i <= SEGMENTS; i++) ctx.lineTo(px[i]!, py[i]!);
        ctx.stroke();
      }

      // Hot white-gold core with bloom.
      const coreR = R * (0.17 + smoothAmp * 0.13 + (ph === "idle" ? breath * 0.015 : 0.025));
      const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR * 3);
      core.addColorStop(0, `rgba(255,246,214,${0.95 * base})`);
      core.addColorStop(0.18, `rgba(255,199,102,${0.75 * base})`);
      core.addColorStop(0.5, `rgba(255,107,26,${0.34 * base})`);
      core.addColorStop(1, "rgba(255,107,26,0)");
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.arc(cx, cy, coreR * 3, 0, Math.PI * 2);
      ctx.fill();

      // SPEAKING: pressure waves pulsing out from the core.
      if (ph === "speaking") {
        for (let k = 0; k < 3; k++) {
          const p = (time * 0.8 + k / 3) % 1;
          const r = R * (0.3 + p * 0.78);
          ctx.strokeStyle = `rgba(255,${170 + k * 18},80,${(1 - p) * 0.32 * base})`;
          ctx.lineWidth = 2 * dpr;
          ctx.beginPath();
          for (let i = 0; i <= 96; i++) {
            const a = (Math.PI * 2 * i) / 96;
            const wob = Math.sin(a * 6 + time * 6) * 6 * dpr * (1 - p);
            const x = cx + Math.cos(a) * (r + wob);
            const y = cy + Math.sin(a) * (r + wob) * 0.82;
            i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
          }
          ctx.stroke();
        }
      }

      // Faint outer shell boundary.
      ctx.strokeStyle = `rgba(255,150,60,${0.14 * base})`;
      ctx.lineWidth = 1 * dpr;
      ctx.beginPath();
      ctx.arc(cx, cy, R * contract * 1.02, 0, Math.PI * 2);
      ctx.stroke();

      // Floating data glyphs at the outer edge.
      ctx.font = `${10 * dpr}px ui-monospace, monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      GLYPHS.forEach((g, i) => {
        const a = (Math.PI * 2 * i) / GLYPHS.length + time * 0.1;
        const r = R * 1.16 + Math.sin(time * 1.5 + i) * 4 * dpr;
        ctx.fillStyle = `rgba(255,190,110,${(0.22 + 0.32 * base) * (0.6 + 0.4 * Math.sin(time * 2 + i))})`;
        ctx.fillText(g, cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.9);
      });
      ctx.restore();

      // Scanlines.
      ctx.save();
      ctx.globalAlpha = 0.045;
      ctx.fillStyle = "#ffb066";
      for (let y = 0; y < h; y += 3 * dpr) ctx.fillRect(0, y, w, 1 * dpr);
      ctx.restore();

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      stream?.getTracks().forEach((tr) => tr.stop());
      void audioCtx?.close().catch(() => {});
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={className ?? "size-full"}
      style={{ background: "#07070a" }}
    />
  );
}
