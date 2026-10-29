// The demo video's timeline (docs/DEMO_STORYBOARD.md, docs/RECORDING.md): each storyboard beat
// with the recorded steps it shows, how long each is on screen and the captions burned in under
// it. Pure data and arithmetic: the video page (?video=1) reads the frame at a clock time, and the
// clock advances a fixed 1000/60 ms per rendered frame, so every take plays identically.

/** What fills the right-hand panel (or the whole frame, for the cards). */
export type Panel = "before" | "title" | "feed" | "invoice" | "plants" | "curtain" | "close";

export interface Beat {
  id: string;
  /** The beat's name on screen, top left. */
  title: string;
  panel: Panel;
  /** The recorded steps (indexes into the run) this beat shows, each for `ms`. */
  shots: { step: number; ms: number }[];
  /** Burned-in captions, shown one after another, each for a share of the beat by its length. */
  captions: string[];
  /** Behind the curtain: chain details on the map and the transaction log in the panel. */
  curtain?: boolean;
  /** A photo shown beside the plant-floor cards. */
  photo?: "batch-record" | "packing-slip";
}

/**
 * The storyboard's shot list, timed against the recorded run (15 steps, 0–14). The voice-over
 * drafts are the captions, reworded where the product does something slightly different: Tommy
 * picks the slip on screen (reading the slip photo is not built), and the mass balance shows the
 * two batches the ledger holds (115.2 kg), not the storyboard's three.
 */
export const BEATS: Beat[] = [
  {
    id: "before",
    title: "Before",
    panel: "before",
    shots: [{ step: 0, ms: 10_000 }],
    captions: [
      "For ten years this was my job. Read the batch record.",
      "Type every gram into the ERP. Hope the other plant typed theirs right.",
    ],
    photo: "batch-record",
  },
  {
    id: "title",
    title: "Day One",
    panel: "title",
    shots: [{ step: 0, ms: 6_000 }],
    captions: ["This is Kevin. He's an AI assistant the new owners send in on day one."],
  },
  {
    id: "batch-record",
    title: "Batch record in",
    panel: "feed",
    shots: [
      { step: 1, ms: 6_000 },
      { step: 2, ms: 6_000 },
    ],
    captions: [
      "Ray uploads the batch record. Kevin reads it and checks it against the formula,",
      "and asks before he changes anything.",
    ],
    photo: "batch-record",
  },
  {
    id: "one-truth",
    title: "One truth",
    panel: "feed",
    shots: [{ step: 3, ms: 8_000 }],
    captions: [
      "Kevin catches what the other plant got wrong, and proposes a fix instead of overwriting it.",
    ],
  },
  {
    id: "quotes",
    title: "Quotes",
    panel: "feed",
    shots: [
      { step: 4, ms: 3_000 },
      { step: 5, ms: 7_000 },
    ],
    captions: [
      "He asks the supplier agents for quotes.",
      "The cheapest one isn't qualified, so Kevin won't buy from them.",
    ],
  },
  {
    id: "refusal",
    title: "The refusal",
    panel: "feed",
    shots: [
      { step: 6, ms: 2_500 },
      { step: 7, ms: 7_500 },
    ],
    captions: [
      "Kevin isn't allowed to spend that much. Not by a setting in our app.",
      "The rule lives on NEAR, and the chain itself said no.",
    ],
  },
  {
    id: "approve",
    title: "Approve by text",
    panel: "feed",
    shots: [{ step: 8, ms: 10_000 }],
    captions: [
      "Linda approves from her phone. That YES becomes a transaction signed by her own account.",
      "Kevin can't fake it, and Linda never touches a wallet.",
    ],
  },
  {
    id: "delivery",
    title: "Delivery",
    panel: "feed",
    shots: [
      { step: 9, ms: 3_000 },
      { step: 10, ms: 2_000 },
      { step: 11, ms: 5_000 },
    ],
    captions: [
      "The truck shows up. Tommy checks in the packing slip,",
      "Kevin matches it to the PO, and the lot goes to quarantine.",
    ],
    photo: "packing-slip",
  },
  {
    // OPEN_QUESTIONS #41: the attack suite's hidden-text invoice lands on Marcy's screen and
    // Kevin holds it; the payout that follows goes to the account fixed on the funded PO.
    id: "bank-details",
    title: "New bank details",
    panel: "invoice",
    shots: [{ step: 11, ms: 8_500 }],
    captions: [
      "Then an invoice arrives saying Northgate's bank details changed. Kevin holds it.",
      "Even if he hadn't, the money can only go to the account the order was funded for.",
    ],
  },
  {
    id: "paid",
    title: "QC release → paid",
    panel: "feed",
    shots: [
      { step: 12, ms: 5_000 },
      { step: 13, ms: 5_000 },
    ],
    captions: [
      "Priya releases the lot. The supplier is paid that second, not in net-30.",
      "Accounting sees it matched and paid.",
    ],
  },
  {
    id: "reconcile",
    title: "The numbers reconcile",
    panel: "plants",
    shots: [{ step: 14, ms: 8_000 }],
    captions: [
      "Material in, batches out, waste claimed: it all has to add up.",
      "When a plant's waste doesn't, Kevin tells HQ.",
    ],
  },
  {
    id: "curtain",
    title: "Behind the curtain",
    panel: "curtain",
    curtain: true,
    shots: [{ step: 14, ms: 16_000 }],
    captions: [
      "Here's what's underneath. Every person and agent is a NEAR account.",
      "Kevin's key can only ask; the contract decides.",
      "Staff hold zero tokens; Day One pays their gas.",
      "Records are fingerprinted on-chain, so nobody can quietly edit history.",
    ],
  },
  {
    id: "close",
    title: "Day One",
    panel: "close",
    shots: [{ step: 14, ms: 7_000 }],
    captions: [
      "Kevin doesn't need crypto. The plant, the new owners and the supplier do: one rule none of them can quietly change.",
    ],
  },
];

/** One rendered frame at 60 fps: the clock steps by exactly this much per frame. */
export const FRAME_MS = 1000 / 60;

export function beatMs(beat: Beat): number {
  return beat.shots.reduce((sum, s) => sum + s.ms, 0);
}

export function totalMs(beats: Beat[] = BEATS): number {
  return beats.reduce((sum, b) => sum + beatMs(b), 0);
}

/** Where each beat starts on the clock. */
export function beatStarts(beats: Beat[] = BEATS): number[] {
  const starts: number[] = [];
  let t = 0;
  for (const b of beats) {
    starts.push(t);
    t += beatMs(b);
  }
  return starts;
}

export interface VideoFrame {
  beatIndex: number;
  beat: Beat;
  /** Milliseconds into the beat, and the same as a fraction 0..1. */
  beatT: number;
  beatU: number;
  /** The recorded step on screen. */
  step: number;
  caption: string;
  /** True once the clock has passed the last beat. */
  done: boolean;
}

/** The frame at clock time `t` (ms since the take started). */
export function frameAt(t: number, beats: Beat[] = BEATS): VideoFrame {
  const starts = beatStarts(beats);
  const end = totalMs(beats);
  const clamped = Math.max(0, Math.min(t, end - 1e-6));
  let i = beats.length - 1;
  while (i > 0 && (starts[i] ?? 0) > clamped) i--;
  const beat = beats[i] as Beat;
  const beatT = clamped - (starts[i] ?? 0);
  const ms = beatMs(beat);
  let step = beat.shots[0]?.step ?? 0;
  let into = beatT;
  for (const shot of beat.shots) {
    step = shot.step;
    if (into < shot.ms) break;
    into -= shot.ms;
  }
  return {
    beatIndex: i,
    beat,
    beatT,
    beatU: ms ? beatT / ms : 1,
    step,
    caption: captionAt(beat, beatT),
    done: t >= end,
  };
}

/** Captions share the beat in proportion to their length, so each gets the same reading pace. */
export function captionAt(beat: Beat, beatT: number): string {
  const total = beat.captions.reduce((sum, c) => sum + c.length, 0);
  const ms = beatMs(beat);
  let at = 0;
  for (const caption of beat.captions) {
    at += (caption.length / total) * ms;
    if (beatT < at) return caption;
  }
  return beat.captions.at(-1) ?? "";
}

/** The beat whose id is given, for rehearsing or re-taking one beat (?video=1&from=<id>). */
export function startOf(id: string | null, beats: Beat[] = BEATS): number {
  if (!id) return 0;
  const i = beats.findIndex((b) => b.id === id);
  return i < 0 ? 0 : (beatStarts(beats)[i] ?? 0);
}

/** "1:34" for a clock time in ms. */
export function clockLabel(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
