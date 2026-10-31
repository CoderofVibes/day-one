// Judge mode's address, kept apart from src/judge.ts so the app's first bundle reads it without
// the recordings judge mode loads with its own chunk.

/** ?judge=1 opens judge mode at step 1, ?judge=<n> at step n, ?judge=summary on its summary. */
export function judgeStart(search: string): number | "summary" | null {
  const v = new URLSearchParams(search).get("judge");
  if (v === null) return null;
  if (v === "summary") return "summary";
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 ? n - 1 : 0;
}
