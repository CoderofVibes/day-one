// One map from a lot's state to its colour (docs/UPGRADE_BRIEF.md §5.2): the pages' pills, the
// flat map's lot labels and the twin's pallets all read it, so "quarantine" is the same amber
// everywhere. `semantic` names the token family (src/tokens.css: --ok, --wait, --bad, --info,
// --neutral); `fill` is the token a map or the twin paints with; `tone` is the pill's.

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
}

export const LOT_STATES = {
  on_order: {
    label: "on order",
    semantic: "neutral",
    style: "solid",
    fill: "--neutral",
    tone: "neutral",
  },
  en_route: {
    label: "on the way",
    semantic: "info",
    style: "outline",
    fill: "--info",
    tone: "held",
  },
  received: { label: "received", semantic: "info", style: "solid", fill: "--info", tone: "held" },
  quarantine: {
    label: "quarantine",
    semantic: "wait",
    style: "solid",
    fill: "--quarantine",
    tone: "waiting",
  },
  released: { label: "released", semantic: "ok", style: "solid", fill: "--ok", tone: "ok" },
  in_use: { label: "in use", semantic: "info", style: "solid", fill: "--info", tone: "held" },
  consumed: {
    label: "consumed",
    semantic: "neutral",
    style: "muted",
    fill: "--neutral",
    tone: "neutral",
  },
  wasted: { label: "wasted", semantic: "bad", style: "muted", fill: "--bad", tone: "refused" },
  rejected: { label: "rejected", semantic: "bad", style: "solid", fill: "--bad", tone: "refused" },
} as const satisfies Record<string, LotStateStyle>;

export type LotState = keyof typeof LOT_STATES;

export function lotStyle(state: string): LotStateStyle {
  return (
    (LOT_STATES as Record<string, LotStateStyle>)[state] ?? {
      label: state.replace(/_/g, " "),
      semantic: "neutral",
      style: "solid",
      fill: "--neutral",
      tone: "neutral",
    }
  );
}
