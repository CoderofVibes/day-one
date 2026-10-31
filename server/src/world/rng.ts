// Seeded randomness for the world generator (docs/UPGRADE_BRIEF.md §2.1.3). Every draw comes
// from a stream keyed by the world seed, a stage and an entity, e.g. stream(seed, "receipts",
// "NGI", "HP-PO-0012"): changing one stage's parameters never reshuffles another stage's draws.
// mulberry32 is small, fast and the same on every machine. Nothing here reads the clock or
// Math.random().

/** FNV-1a over a string: the 32-bit start state of a stream. */
export function fnv1a(text: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform in [lo, hi). */
  between(lo: number, hi: number): number;
  /** Uniform integer in [lo, hi], both included. */
  int(lo: number, hi: number): number;
  chance(p: number): boolean;
  /** Normal by Box-Muller. */
  normal(mean: number, sd: number): number;
}

function mulberry32(state: number): () => number {
  let a = state >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** One independent stream per (seed, stage, entity...) key. */
export function stream(seed: string, ...key: readonly (string | number)[]): Rng {
  const next = mulberry32(fnv1a([seed, ...key].join("\u0000")));
  const rng: Rng = {
    next,
    between: (lo, hi) => lo + (hi - lo) * next(),
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    chance: (p) => next() < p,
    normal: (mean, sd) => {
      const u = 1 - next();
      const v = next();
      return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
  };
  return rng;
}
