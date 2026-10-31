// One map from a lot's state to its colour (docs/UPGRADE_BRIEF.md §5.2): the pages' pills, the
// flat map's lot labels and the twin's pallets all read it, so "quarantine" is the same amber
// everywhere. `semantic` names the token family (src/tokens.css: --ok, --wait, --bad, --info,
// --neutral); `fill` is the token a map or the twin paints with; `tone` is the pill's; `onSite`
// says whether a lot in that state stands in the plant as a pallet.

import type { Tone } from "./run.ts";

export type Semantic = "ok" | "wait" | "bad" | "money" | "chain" | "info" | "neutral";

export interface LotStateStyle {
  label: string;
  semantic: Semantic;
  /** Solid fill, an outline (on its way), or muted (gone, not refused). */
  style: "solid" | "outline" | "muted";
  /** The CSS custom property the map and the twin paint the lot with. */
  fill: string;
  tone: Tone;
  /** A pallet on site: received and not yet used up or sent back. */
  onSite: boolean;
}

export const LOT_STATES = {
  on_order: {
    label: "on order",
    semantic: "neutral",
    style: "solid",
    fill: "--neutral",
    tone: "neutral",
    onSite: false,
  },
  en_route: {
    label: "on the way",
    semantic: "info",
    style: "outline",
    fill: "--info",
    tone: "neutral",
    onSite: false,
  },
  received: {
    label: "received",
    semantic: "info",
    style: "solid",
    fill: "--info",
    tone: "held",
    onSite: true,
  },
  quarantine: {
    label: "quarantine",
    semantic: "wait",
    style: "solid",
    fill: "--quarantine",
    tone: "waiting",
    onSite: true,
  },
  released: {
    label: "released",
    semantic: "ok",
    style: "solid",
    fill: "--ok",
    tone: "ok",
    onSite: true,
  },
  in_use: {
    label: "in use",
    semantic: "info",
    style: "solid",
    fill: "--info",
    tone: "held",
    onSite: true,
  },
  consumed: {
    label: "consumed",
    semantic: "neutral",
    style: "muted",
    fill: "--neutral",
    tone: "neutral",
    onSite: false,
  },
  wasted: {
    label: "wasted",
    semantic: "bad",
    style: "muted",
    fill: "--bad",
    tone: "refused",
    onSite: false,
  },
  rejected: {
    label: "rejected",
    semantic: "bad",
    style: "solid",
    fill: "--bad",
    tone: "refused",
    onSite: true,
  },
} as const satisfies Record<string, LotStateStyle>;

export type LotState = keyof typeof LOT_STATES;

export function isLotState(state: string): state is LotState {
  return Object.hasOwn(LOT_STATES, state);
}

/** A state's look; an unknown state reads as its words, neutral and off site. */
export function lotStyle(state: string): LotStateStyle {
  return isLotState(state)
    ? LOT_STATES[state]
    : {
        label: state.replace(/_/g, " "),
        semantic: "neutral",
        style: "solid",
        fill: "--neutral",
        tone: "neutral",
        onSite: false,
      };
}

/** A lot state's look with a CSS colour, for marks that are not pills: a node's edge, a swatch. */
export interface LotStateLook {
  label: string;
  tone: Tone;
  color: string;
}

/** A lot placed on hold in the recall drill: the page's overlay, never the ledger's state. */
export const ON_HOLD: LotStateLook = {
  label: "on hold (drill)",
  tone: "waiting",
  color: "var(--quarantine)",
};

/** A state in staff words with its pill tone and colour; no state reads as a dash. */
export function lotState(state: string | null | undefined): LotStateLook {
  if (!state) return { label: "—", tone: "neutral", color: "var(--neutral)" };
  const { label, tone, fill } = lotStyle(state);
  return { label, tone, color: `var(${fill})` };
}
