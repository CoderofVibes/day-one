// What the global header shows, read from the run: each person's next turn and the theme a viewer
// picked (Kevin's status is the feed's, activity.ts kevinStatus). Pure, so the header and its tests read the same thing.

import { type Audience, audienceOf, type Step } from "./run.ts";

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

/**
 * The theme this viewer picked. Dark is the default for a first visit (Tony, Nov 2), so the intro
 * and the tour open dark; the video and Linda's phone keep following the device. System is stored
 * as a choice, so someone who picks it keeps it.
 */
export function storedTheme(): ThemeChoice {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {
    // Blocked storage: the default below.
  }
  const q = new URLSearchParams(typeof location === "undefined" ? "" : location.search);
  // The app framed inside the video page follows the device like the video page itself, so a
  // take does not cut between a light frame and a dark app.
  return q.get("video") === "1" || q.get("page") === "approve" || q.get("recordedFrame") === "1"
    ? "system"
    : "dark";
}

/** Sets the stored (or default) theme before the first paint, without remembering it. */
export function initTheme(): void {
  const choice = storedTheme();
  if (choice !== "system") document.documentElement.setAttribute("data-theme", choice);
}

/** Set the page's theme (System follows the device) and remember it where storage allows. */
export function applyTheme(choice: ThemeChoice): void {
  const root = document.documentElement;
  if (choice === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", choice);
  try {
    localStorage.setItem(THEME_KEY, choice);
  } catch {
    // Private windows and blocked storage: the theme holds for this visit.
  }
}
