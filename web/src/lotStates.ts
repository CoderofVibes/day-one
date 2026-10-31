// Lot states in staff words, with the pill tone and the colour every view uses for them
// (docs/UPGRADE_BRIEF.md §2.3): amber quarantine, green released, gray consumed, red rejected,
// blue in use. One map, so the tables, the genealogy graph and the twin agree.
// The colours are custom properties in lots.css, light and dark.

import type { Tone } from "./run.ts";

export interface LotStateLook {
  label: string;
  tone: Tone;
  /** A CSS colour for the state's mark: a node's edge, a dot, a swatch. */
  color: string;
}

export const LOT_STATES: Record<string, LotStateLook> = {
  on_order: { label: "on order", tone: "neutral", color: "var(--lot-other)" },
  en_route: { label: "on the way", tone: "neutral", color: "var(--lot-other)" },
  received: { label: "received", tone: "held", color: "var(--lot-quarantine)" },
  quarantine: { label: "quarantine", tone: "waiting", color: "var(--lot-quarantine)" },
  released: { label: "released", tone: "ok", color: "var(--lot-released)" },
  in_use: { label: "in use", tone: "ok", color: "var(--lot-in-use)" },
  consumed: { label: "consumed", tone: "neutral", color: "var(--lot-consumed)" },
  wasted: { label: "wasted", tone: "refused", color: "var(--lot-rejected)" },
  rejected: { label: "rejected", tone: "refused", color: "var(--lot-rejected)" },
};

/** A lot placed on hold in the recall drill: the page's overlay, never the ledger's state. */
export const ON_HOLD: LotStateLook = {
  label: "on hold (drill)",
  tone: "waiting",
  color: "var(--lot-quarantine)",
};

export function lotState(state: string | null | undefined): LotStateLook {
  const s = state ?? "";
  return (
    LOT_STATES[s] ?? {
      label: s.replace(/_/g, " ") || "—",
      tone: "neutral",
      color: "var(--lot-other)",
    }
  );
}
