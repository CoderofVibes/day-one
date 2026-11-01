// Kevin's presence on the first shift (Astra's first pass, B1 and B2): a fine green line across a
// quiet screen. Small waves travel through it while a caption is new, then it rests while the
// caption is read. It is not an audio meter and never claims to be listening or working; the name
// under it and the captions carry the meaning. Reduced motion keeps it a straight line.

import { useEffect, useRef } from "react";

const POINTS = 17;
const AMP = 7;
const EASE_MS = 180;

/** The line's path at time `t` (ms) with amplitude `a` (px), ends level. */
export function wavePath(t: number, a: number, width = 240): string {
  const left = 8;
  const right = width - 8;
  const pts = Array.from({ length: POINTS }, (_, i) => {
    const u = i / (POINTS - 1);
    const y =
      24 + a * Math.sin(Math.PI * u) ** 2 * Math.sin(4 * Math.PI * u - (2 * Math.PI * t) / 1600);
    return [left + u * (right - left), y] as const;
  });
  // A smooth curve through the points: each segment's control point is the midpoint rule.
  let d = `M${pts[0]?.[0].toFixed(1)} ${pts[0]?.[1].toFixed(2)}`;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1] as readonly [number, number];
    const [x1, y1] = pts[i] as readonly [number, number];
    d += ` Q${x0.toFixed(1)} ${y0.toFixed(2)} ${((x0 + x1) / 2).toFixed(1)} ${((y0 + y1) / 2).toFixed(2)}`;
  }
  const end = pts.at(-1) as readonly [number, number];
  return `${d} L${end[0].toFixed(1)} ${end[1].toFixed(2)}`;
}

/** Amplitude `ms` into a caption's wave: eases up, holds, eases back to still. */
export function amplitude(ms: number, waveMs: number): number {
  if (ms < 0 || ms > waveMs) return 0;
  if (ms < EASE_MS) return AMP * (ms / EASE_MS);
  if (ms > waveMs - EASE_MS) return AMP * ((waveMs - ms) / EASE_MS);
  return AMP;
}

export function KevinPresence({
  waveFrom,
  waveMs,
  state,
  width = 240,
}: {
  /** When the current caption's wave began (performance.now()), or null for a still line. */
  waveFrom: number | null;
  waveMs: number;
  state: "idle" | "presenting" | "finished";
  width?: number;
}) {
  const path = useRef<SVGPathElement>(null);
  useEffect(() => {
    const el = path.current;
    if (!el) return;
    const still = wavePath(0, 0, width);
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (waveFrom === null || reduced) {
      el.setAttribute("d", still);
      return;
    }
    let id = 0;
    const tick = (now: number) => {
      const ms = now - waveFrom;
      el.setAttribute("d", wavePath(now, amplitude(ms, waveMs), width));
      // The loop stops once the wave has rested: nothing animates while a caption is read.
      if (ms <= waveMs) id = requestAnimationFrame(tick);
      else el.setAttribute("d", still);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [waveFrom, waveMs, width]);
  return (
    <div className={`kevin-presence ${state}`}>
      <svg viewBox={`0 0 ${width} 48`} width={width} height={48} aria-hidden="true">
        <path ref={path} d={wavePath(0, 0, width)} />
      </svg>
      <span className="kevin-presence-name">Kevin</span>
    </div>
  );
}
