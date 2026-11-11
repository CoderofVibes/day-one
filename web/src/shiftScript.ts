// The first shift (Astra's first pass, docs/astra/2026-11-01_FirstShift.md B and C; Tony's shape,
// OPEN_QUESTIONS #45 and #46): the first time someone opens Day One, Kevin introduces himself on a
// quiet screen while Ray's desk fades in behind him, then walks Ray's first morning in six stops and
// shows why he can be trusted in three more, behind the curtain. Pure data and the first-open rule,
// so the tests read it without a page. Every line is authored copy held to what the build does:
// no model wrote it, and it carries no "signed in enclave" mark.

import { attacks, type ProofLink, po1042 } from "./judge.ts";
import { run as recorded, type Transaction } from "./run.ts";
import type { PageId } from "./shell.tsx";

/** What a returning visitor has done, so the intro opens once. */
export const FIRST_SHIFT_KEY = "day-one:first-shift:v1";
/** The old explainer card's "closed" flag: someone who closed it has been here before. */
const OLD_GUIDE_KEY = "day-one-guide-closed";
/** The replay clock's stored place: someone with a saved place is coming back to their work. */
const CLOCK_KEY = "day-one-clock";

interface Store {
  getItem(key: string): string | null;
}

/**
 * Whether the intro opens by itself: only on a bare first visit to the recorded replay. Any query
 * or hash (a page, a plant, an inspected object, judge mode, the video, Linda's phone) is someone
 * who asked for a particular screen, and that wins. Blocked storage counts as a first visit.
 */
export function opensByItself(search: string, hash: string, store: Store | null): boolean {
  if (search.replace(/^\?/, "") !== "" || hash.replace(/^#/, "") !== "") return false;
  try {
    if (!store) return true;
    return (
      store.getItem(FIRST_SHIFT_KEY) === null &&
      store.getItem(OLD_GUIDE_KEY) !== "1" &&
      store.getItem(CLOCK_KEY) === null
    );
  } catch {
    return true;
  }
}

/** Remembers that the intro was seen, and how the walkthrough ended. */
export function remember(choice: "skipped" | "walked" | "finished"): void {
  try {
    localStorage.setItem(FIRST_SHIFT_KEY, JSON.stringify({ introSeen: true, walkthrough: choice }));
  } catch {
    // A private window may refuse storage; the intro then opens again next time.
  }
}

/** Kevin's introduction: three captions, each with when it starts (ms from the open). */
export const INTRO_LINES: { at: number; text: string }[] = [
  { at: 400, text: "Good morning, Ray. Welcome to Acme's Day One program at Hollow Pine." },
  { at: 5_400, text: "I'm Kevin, your purchasing and inventory assistant." },
  {
    at: 8_800,
    text: "I've reviewed your weekend mail. I'll show you what's ready and what needs you.",
  },
];
/** How long a caption's line moves before it rests while the caption is read. */
export const WAVE_MS = 2_400;
/** The program behind the intro: how visible it is from each caption on. */
export const FADE = [0, 0.06, 0.14];

/** The caption on screen at `t` ms, or -1 before the first. */
export function captionAt(t: number): number {
  let i = -1;
  INTRO_LINES.forEach((l, n) => {
    if (t >= l.at) i = n;
  });
  return i;
}

export interface GuideStop {
  id: string;
  /** The part of the morning it belongs to: Ray's own work, or why he can trust Kevin. */
  part: "morning" | "trust";
  title: string;
  /** What Kevin says, in his own voice. */
  line: string;
  page: PageId;
  /** The recorded step the run is set to (src/data/demo-run.json, 0–14). */
  at: number;
  /** What the spotlight frames, as a CSS selector. */
  spotlight: string;
  /** Behind the curtain: on for the trust stops only; Ray's screen never shows the chain. */
  curtain: boolean;
  /** Opens the plant twin on this object (its ?inspect= id). */
  inspect?: string;
  /** Linda's phone over the page. */
  overlay?: "phone";
  /** Recorded testnet transactions behind what the stop says (trust stops only). */
  links: ProofLink[];
  /** About how long it takes to read and look, for the progress line. */
  seconds: number;
}

const step = (title: string) => recorded.steps.findIndex((s) => s.title === title);
const refusedAt = step("Big PO");
const paidAt = step("Paid");
const po = po1042();
const attack = attacks();
const link = (t: Transaction | undefined, label: string): ProofLink[] =>
  t?.url ? [{ label, url: t.url }] : [];

/** Ray's first morning in six stops, then three behind the curtain (OPEN_QUESTIONS #46). */
export const GUIDE_STOPS: GuideStop[] = [
  {
    id: "overnight",
    part: "morning",
    title: "Overnight",
    line: "I reviewed ten messages since Friday. Three draft changes need your signature, one request was refused, and six messages need nothing.",
    page: "overview",
    at: 0,
    spotlight: '[data-guide="morning-summary"]',
    curtain: false,
    links: [],
    seconds: 12,
  },
  {
    id: "your-task",
    part: "morning",
    title: "What needs you",
    line: "First, hand me batch record BR-B-1045 from the binder, or a photo of it. I'll read it against the recipe. You confirm what I read before it enters the plant ledger.",
    page: "overview",
    at: 0,
    spotlight: ".desk-card.need",
    curtain: false,
    links: [],
    seconds: 14,
  },
  {
    id: "on-the-plant",
    part: "morning",
    title: "Where it is",
    line: "That record belongs with the presses. Every task on your desk has a Show on the plant link that brings you here, to the place it concerns.",
    page: "map",
    at: 0,
    spotlight: ".map-frame",
    curtain: false,
    inspect: "dept-B-compression",
    links: [],
    seconds: 10,
  },
  {
    id: "drafts",
    part: "morning",
    title: "Check before you sign",
    line: "Linda asked to move BR-B-1049 to Thursday, November 12. I've drafted that change, a larger BR-B-1048, and a note about Northgate's price notice. Your signature changes the schedule or a vendor note; it never moves money.",
    page: "overview",
    at: 0,
    spotlight: ".handled-list",
    curtain: false,
    links: [],
    seconds: 18,
  },
  {
    id: "limits",
    part: "morning",
    title: "What I may spend",
    line: "Acme lets me spend up to $2,500 on one order and $60,000 a month. Over that, Linda approves by text. I cannot go around those rules.",
    page: "purchasing",
    at: 0,
    spotlight: '[data-guide="purchasing-limits"]',
    curtain: false,
    links: [],
    seconds: 13,
  },
  {
    id: "books",
    part: "morning",
    title: "Acme's books",
    line: "Day One keeps your batch records and lots. Acme's books show the order, the receipt, the bill and the payment. Payment waits for delivery and QC, for the quantity counted in and the invoice. (A demo ERP, not a live integration.)",
    page: "erp",
    at: 0,
    spotlight: ".two-systems",
    curtain: false,
    links: [],
    seconds: 14,
  },
  {
    id: "refused",
    part: "trust",
    title: "Why you can trust me",
    line: "Here's what's underneath. When I tried to place PO-1042 for $5,150, the spending rule refused it. Not a setting in this app: a rule on NEAR that I cannot change. That's why it went to Linda.",
    page: "overview",
    at: refusedAt,
    spotlight: ".desk-card.need",
    curtain: true,
    links: link(po.refused, "the order the spending rule refused"),
    seconds: 15,
  },
  {
    id: "paid",
    part: "trust",
    title: "Her yes, and the money",
    // Said to Ray in his words; the key and the fee are on the curtain beside it (finding 6).
    line: "Linda's yes reached the spending rule as her approval; in this replay her text is simulated and the server signs for her. The money waited, set aside, and went to Northgate only after Tommy confirmed delivery and Priya released the lot. The panel on the right shows each step on NEAR.",
    page: "overview",
    at: paidAt,
    spotlight: ".desk-card",
    curtain: true,
    links: [
      ...link(po.approved, "Linda's approval"),
      ...link(po.funded, "the money set aside"),
      ...link(po.released, "the release that paid Northgate"),
    ],
    seconds: 15,
  },
  {
    id: "attacks",
    part: "trust",
    title: `${attack.refused} of ${attack.total} attacks refused`,
    line: `And we tried to break it: ${attack.total} attacks, from a lookalike supplier to an email asking for new bank details. Each one was stopped: by me, by the mock ERP or by the contract.`,
    page: "arena",
    at: recorded.steps.length - 1,
    spotlight: ".arena-list",
    curtain: true,
    links: attack.links.slice(0, 2),
    seconds: 12,
  },
];

/** "About 1:40 left" from stop `i` on. */
export function timeLeft(i: number, stops: GuideStop[] = GUIDE_STOPS): string {
  const s = stops.slice(i).reduce((sum, x) => sum + x.seconds, 0);
  return s >= 60
    ? `about ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")} left`
    : `about ${s} s left`;
}
