// What the global header shows, read from the run: Kevin's status in a word, each person's next
// turn, and the theme a viewer picked. Pure, so the header and its tests read the same thing.

import { type Audience, audienceOf, type Step, statusOf } from "./run.ts";

export type KevinState = "idle" | "reading" | "drafting" | "waiting" | "paying" | "signed";

export interface KevinStatus {
  state: KevinState;
  label: string;
}

/**
 * What Kevin is doing once a step has happened: reading a scan or quotes, drafting the next
 * move, waiting on whoever acts next, paying (escrow funded or released), or signed (a record
 * anchored). `nextWho` is the next person in the run, null when nobody is.
 */
export function kevinStatus(step: Step | undefined, nextWho: string | null): KevinStatus {
  const first = nextWho?.split(" ")[0];
  const waiting = (): KevinStatus =>
    first && first !== "Kevin" && first !== "Day"
      ? { state: "waiting", label: `waiting on ${first}` }
      : { state: "idle", label: "idle" };
  if (!step) return { state: "idle", label: "idle" };
  const t = step.title;
  const tone = statusOf(step).tone;
  if (t.startsWith("Upload ") || t === "Quotes") return { state: "reading", label: "reading" };
  if (t.endsWith(" confirms") || t === "Paid") return { state: "signed", label: "signed ✓" };
  if (t === "Discrepancy" || t === "Forecast") return { state: "drafting", label: "drafting" };
  if (t === "Small PO" || t === "Big PO" || t === "Kevin retries")
    return tone === "held" ? { state: "paying", label: "paying" } : waiting();
  if (t.endsWith(" texts"))
    return tone === "ok" ? { state: "drafting", label: "drafting" } : waiting();
  if (t === "QC release") return { state: "paying", label: "paying" };
  if (t === "Supplier ships" || t === "Delivery") return waiting();
  return { state: "idle", label: "idle" };
}

/** The four people a viewer can step into, each with their own "up next". */
export const PEOPLE: { name: string; role: string }[] = [
  { name: "Ray Delgado", role: "Purchaser" },
  { name: "Linda Park", role: "Ops director" },
  { name: "Marcy Allen", role: "Accounting" },
  { name: "Priya Natarajan", role: "QC" },
];

/** The index of this person's next step after `at`, or null when the run holds none. */
export function nextTurn(steps: Step[], at: number, name: string): number | null {
  for (let i = at + 1; i < steps.length; i++) {
    const step = steps[i] as Step;
    let who: Audience;
    try {
      who = audienceOf(step);
    } catch {
      continue;
    }
    if (who.name === name) return i;
  }
  return null;
}

export type ThemeChoice = "system" | "light" | "dark";
const THEME_KEY = "day-one-theme";

/** The theme this viewer picked; System when nothing is stored or storage is blocked. */
export function storedTheme(): ThemeChoice {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

/** Set the page's theme (System follows the device) and remember it where storage allows. */
export function applyTheme(choice: ThemeChoice): void {
  const root = document.documentElement;
  if (choice === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", choice);
  try {
    if (choice === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, choice);
  } catch {
    // Private windows and blocked storage: the theme holds for this visit.
  }
}
