// Idle life for a face preview: blinks every few seconds, glances around, optional talking.

import { useEffect, useRef, useState } from "react";
import { NEUTRAL, type FaceState, type Mood } from "../../core/display/face";

/** Idle life: blinks, glances around, optional talking. Runs only while "Alive" is on. */
export function useAlive(on: boolean, talking: boolean, mood: Mood): FaceState {
  const [state, setState] = useState<FaceState>({ ...NEUTRAL, mood });
  const plan = useRef({ nextBlink: 0, blinkStart: -1, look: [0, 0], target: [0, 0], nextLook: 0 });
  useEffect(() => {
    if (!on) {
      setState({ ...NEUTRAL, mood });
      return;
    }
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = now - start;
      const p = plan.current;
      if (t >= p.nextBlink) { p.blinkStart = t; p.nextBlink = t + 2200 + Math.random() * 3200; }
      const bt = t - p.blinkStart;
      const blink = p.blinkStart >= 0 && bt < 180 ? Math.sin((bt / 180) * Math.PI) : 0;
      if (t >= p.nextLook) {
        p.target = Math.random() < 0.35 ? [0, 0] : [Math.random() * 2 - 1, (Math.random() * 2 - 1) * 0.6];
        p.nextLook = t + 1200 + Math.random() * 2400;
      }
      p.look = [p.look[0]! + (p.target[0]! - p.look[0]!) * 0.12, p.look[1]! + (p.target[1]! - p.look[1]!) * 0.12];
      const talk = talking ? Math.max(0, Math.sin(t / 90) * 0.5 + Math.sin(t / 37) * 0.35 + 0.15) : 0;
      setState({ mood, blink, lookX: p.look[0]!, lookY: p.look[1]!, talk });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [on, talking, mood]);
  return state;
}

