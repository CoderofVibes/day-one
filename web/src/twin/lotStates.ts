// The lot-state map (docs/UPGRADE_BRIEF.md §5.2): one place that says what each ledger lot state
// is called, which pill tone it takes on the pages and which colour token the maps paint it with,
// and whether a lot in that state stands in the plant as a pallet. The pages' lot pills, the plant
// map's legend and the 3D pallets all read it.

import type { Tone } from "../run.ts";

export type LotStateKey =
  | "on_order"
  | "en_route"
  | "received"
  | "quarantine"
  | "released"
  | "in_use"
  | "consumed"
  | "wasted"
  | "rejected";

export interface LotStateLook {
  label: string;
  tone: Tone;
  /** The CSS custom property (src/tokens.css) the maps colour it with. */
  token: string;
  /** A pallet on site: received and not yet used up or sent back. */
  onSite: boolean;
}

export const LOT_STATES: Record<LotStateKey, LotStateLook> = {
  on_order: { label: "on order", tone: "neutral", token: "--map-off", onSite: false },
  en_route: { label: "on the way", tone: "neutral", token: "--held", onSite: false },
  received: { label: "received", tone: "held", token: "--held", onSite: true },
  quarantine: { label: "quarantine", tone: "waiting", token: "--quarantine", onSite: true },
  released: { label: "released", tone: "ok", token: "--paid", onSite: true },
  in_use: { label: "in use", tone: "ok", token: "--held", onSite: true },
  consumed: { label: "consumed", tone: "neutral", token: "--map-off", onSite: false },
  wasted: { label: "wasted", tone: "refused", token: "--refused", onSite: false },
  rejected: { label: "rejected", tone: "refused", token: "--refused", onSite: true },
};

export function isLotState(state: string): state is LotStateKey {
  return Object.hasOwn(LOT_STATES, state);
}

/** A state's label and tone; an unknown state reads as its words, neutral. */
export function lotLook(state: string): LotStateLook {
  return isLotState(state)
    ? LOT_STATES[state]
    : { label: state.replace(/_/g, " "), tone: "neutral", token: "--map-off", onSite: false };
}
