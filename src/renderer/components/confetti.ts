// A short burst of confetti for happy moments (a print is sliced, a file is on the card).
// Skipped when the system asks for reduced motion.

import { PARTY_COLORS } from "../theme";

interface Bit { x: number; y: number; vx: number; vy: number; r: number; spin: number; angle: number; color: string; w: number; h: number }

export function confetti(from?: { x: number; y: number }) {
  if (typeof window === "undefined" || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  const canvas = document.createElement("canvas");
  canvas.className = "confetti-canvas";
  const dpr = window.devicePixelRatio || 1;
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  document.body.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  if (!ctx) { canvas.remove(); return; }
  ctx.scale(dpr, dpr);
  const ox = from?.x ?? window.innerWidth / 2;
  const oy = from?.y ?? window.innerHeight / 3;
  const bits: Bit[] = Array.from({ length: 140 }, () => {
    const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.1;
    const speed = 7 + Math.random() * 9;
    return {
      x: ox, y: oy, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
      r: 0, spin: (Math.random() - 0.5) * 0.4, angle: Math.random() * Math.PI,
      color: PARTY_COLORS[Math.floor(Math.random() * PARTY_COLORS.length)]!,
      w: 6 + Math.random() * 6, h: 4 + Math.random() * 4,
    };
  });
  const start = performance.now();
  const frame = (now: number) => {
    const t = now - start;
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    for (const b of bits) {
      b.vy += 0.32;
      b.vx *= 0.985;
      b.x += b.vx;
      b.y += b.vy;
      b.angle += b.spin;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - t / 1800);
      ctx.translate(b.x, b.y);
      ctx.rotate(b.angle);
      ctx.fillStyle = b.color;
      ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h);
      ctx.restore();
    }
    if (t < 1800) requestAnimationFrame(frame);
    else canvas.remove();
  };
  requestAnimationFrame(frame);
}
