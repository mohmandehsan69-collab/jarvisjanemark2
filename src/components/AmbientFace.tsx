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

/** Amber holographic HUD. Canvas + rAF, driven by the voice phase. */
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

    const hex = (cx: number, cy: number, r: number) => {
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i - Math.PI / 6;
        const x = cx + Math.cos(a) * r;
        const y = cy + Math.sin(a) * r;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.stroke();
    };

    const draw = (t: number) => {
      if (disposed) return;
      const w = canvas.width;
      const h = canvas.height;
      const cx = w / 2;
      const cy = h / 2;
      const R = Math.min(w, h) / 2 - 6 * dpr;
      const ph = phaseRef.current;
      const on = activeRef.current;
      const time = t / 1000;

      if (ph === "listening") void openMic();
      amp = ph === "listening" ? readAmp() : 0;
      smoothAmp += (amp - smoothAmp) * 0.18;

      const breath = 0.5 + 0.5 * Math.sin(time * 1.1);
      const base = ph === "idle" || !on ? 0.32 + breath * 0.1 : 0.75;
      const spin = ph === "thinking" ? 3.2 : ph === "speaking" ? 1.4 : 0.55;

      ctx.clearRect(0, 0, w, h);
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.lineWidth = 1 * dpr;

      // Hex wireframe mesh behind everything.
      ctx.strokeStyle = `rgba(255,140,40,${0.06 * base + 0.03})`;
      const cell = R / 3.4;
      for (let ring = 0; ring < 4; ring++) {
        const rr = cell * (ring + 0.6);
        for (let k = 0; k < 6; k++) {
          const a = (Math.PI / 3) * k + time * 0.05;
          hex(cx + Math.cos(a) * rr * 0.55, cy + Math.sin(a) * rr * 0.55, cell * 0.5);
        }
      }

      // Concentric rotating rings with tick marks.
      const rings = [
        { r: R, sp: 0.18, op: 0.5, ticks: 72 },
        { r: R * 0.86, sp: -0.34, op: 0.36, ticks: 36 },
        { r: R * 0.68, sp: 0.62, op: 0.42, ticks: 24 },
        { r: R * 0.5, sp: -0.9, op: 0.3, ticks: 12 },
      ];
      rings.forEach((ring, idx) => {
        const expand = idx === 0 ? 1 + smoothAmp * 0.12 : 1 + smoothAmp * 0.04;
        const r = ring.r * expand;
        const rot = time * ring.sp * spin;
        ctx.strokeStyle = `rgba(255,${170 + idx * 12},${90 + idx * 20},${ring.op * base})`;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();

        ctx.strokeStyle = `rgba(255,199,102,${(ring.op + 0.15) * base})`;
        for (let i = 0; i < ring.ticks; i++) {
          const a = rot + (Math.PI * 2 * i) / ring.ticks;
          const long = i % 6 === 0;
          const l = (long ? 10 : 4) * dpr;
          ctx.beginPath();
          ctx.moveTo(cx + Math.cos(a) * (r - l), cy + Math.sin(a) * (r - l));
          ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
          ctx.stroke();
        }
      });

      // Radial gridlines.
      ctx.strokeStyle = `rgba(255,120,30,${0.16 * base})`;
      for (let i = 0; i < 16; i++) {
        const a = (Math.PI * 2 * i) / 16 + time * 0.04;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * R * 0.52, cy + Math.sin(a) * R * 0.52);
        ctx.lineTo(cx + Math.cos(a) * R * 0.98, cy + Math.sin(a) * R * 0.98);
        ctx.stroke();
      }

      // THINKING: radar sweep.
      if (ph === "thinking") {
        const a = time * 2.6;
        const grad = ctx.createLinearGradient(
          cx,
          cy,
          cx + Math.cos(a) * R,
          cy + Math.sin(a) * R,
        );
        grad.addColorStop(0, "rgba(255,107,26,0.35)");
        grad.addColorStop(1, "rgba(255,199,102,0)");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, R, a - 0.55, a);
        ctx.closePath();
        ctx.fill();
      }

      // SPEAKING: waveform bloom radiating outward.
      if (ph === "speaking") {
        for (let k = 0; k < 3; k++) {
          const p = ((time * 0.75 + k / 3) % 1);
          const r = R * (0.45 + p * 0.6);
          ctx.strokeStyle = `rgba(255,${150 + k * 20},60,${(1 - p) * 0.4})`;
          ctx.lineWidth = 2 * dpr;
          ctx.beginPath();
          for (let i = 0; i <= 96; i++) {
            const a = (Math.PI * 2 * i) / 96;
            const wob = Math.sin(a * 7 + time * 6) * 5 * dpr * (1 - p);
            const x = cx + Math.cos(a) * (r + wob);
            const y = cy + Math.sin(a) * (r + wob);
            i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
          }
          ctx.stroke();
        }
        ctx.lineWidth = 1 * dpr;
      }

      // Core with bloom.
      const coreR = R * (0.2 + smoothAmp * 0.14 + (ph === "idle" ? breath * 0.02 : 0.03));
      const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR * 2.4);
      core.addColorStop(0, `rgba(255,199,102,${0.85 * base})`);
      core.addColorStop(0.35, `rgba(255,107,26,${0.5 * base})`);
      core.addColorStop(1, "rgba(255,107,26,0)");
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.arc(cx, cy, coreR * 2.4, 0, Math.PI * 2);
      ctx.fill();

      // Floating data glyphs at the outer edge.
      ctx.font = `${9 * dpr}px ui-monospace, monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      GLYPHS.forEach((g, i) => {
        const a = (Math.PI * 2 * i) / GLYPHS.length + time * 0.12;
        const r = R * 1.0 + Math.sin(time * 1.5 + i) * 3 * dpr;
        ctx.fillStyle = `rgba(255,190,110,${(0.25 + 0.35 * base) * (0.6 + 0.4 * Math.sin(time * 2 + i))})`;
        ctx.fillText(g, cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      });
      ctx.restore();

      // Scanlines.
      ctx.save();
      ctx.globalAlpha = 0.05;
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
      style={{ background: "#07070a", borderRadius: "9999px" }}
    />
  );
}