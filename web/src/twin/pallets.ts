// The plant map's pallets (docs/UPGRADE_BRIEF.md §4.4, §4.14 step 2): one per lot on site, from
// the lots the seed holds (the bundled snapshot, src/reads.ts readSnapshotLots) and the run's own
// lots at the step shown (TwinState.lots). A lot the run delivers is left out of the snapshot and
// drawn from the run, so it appears at the delivery and turns from quarantine to released when QC
// decides. Pure: the 3D view, the inspector and the tests share it.

import { qty } from "../charts.tsx";
import type { LotView } from "../reads.ts";
import type { RunData } from "../run.ts";
import type { AreaCode } from "./layout.ts";
import { isLotState, LOT_STATES, type LotStateKey } from "./lotStates.ts";
import { deriveTwinState, type FacilityId, type TwinOptions, type TwinState } from "./model.ts";

export interface Pallet {
  code: string;
  /** "Ascorbic acid". */
  name: string;
  vendor: string | null;
  /** "700 kg", "61,319". */
  qty: string;
  state: LotStateKey;
  facility: FacilityId;
  /** The warehouse area it stands in. */
  area: AreaCode;
  /** True for a lot the run itself delivers. */
  run: boolean;
}

/** Where a lot stands: quarantine until QC decides, then raw material or packaging storage. */
export function stockArea(category: string, state: LotStateKey): AreaCode {
  if (state === "quarantine" || state === "received" || state === "rejected") return "quarantine";
  return category === "packaging" ? "pkg_storage" : "rm_storage";
}

/** The lots a run delivers, at any step: drawn from the run, not from the snapshot. */
export function runLotCodes(run: RunData, options?: TwinOptions): Set<string> {
  const codes = new Set<string>();
  for (let t = 0; t < run.steps.length; t++)
    for (const l of deriveTwinState(run, t, options).lots) codes.add(l.code);
  return codes;
}

/** Every pallet on site at the state shown: the snapshot's lots on hand, then the run's lots. */
export function palletsAt(stock: LotView[], state: TwinState, runLots: Set<string>): Pallet[] {
  const byCode = new Map(stock.map((l) => [l.lotCode, l]));
  const out: Pallet[] = [];
  for (const l of stock) {
    if (runLots.has(l.lotCode) || !isLotState(l.state)) continue;
    if (!LOT_STATES[l.state].onSite || l.onHandBase <= 0) continue;
    out.push({
      code: l.lotCode,
      name: l.name,
      vendor: l.vendor,
      qty: qty(l.onHandBase, l.dimension),
      state: l.state,
      facility: l.facility as FacilityId,
      area: stockArea(l.category, l.state),
      run: false,
    });
  }
  for (const l of state.lots) {
    const seen = byCode.get(l.code);
    out.push({
      code: l.code,
      name: seen?.name ?? l.code,
      vendor: seen?.vendor ?? null,
      qty: seen ? qty(seen.onHandBase, seen.dimension) : "",
      state: l.state,
      facility: l.facility,
      // The run's lot stays in the quarantine cage it was delivered to (scene.ts blendLots).
      area: "quarantine",
      run: true,
    });
  }
  return out;
}

export function countByState(
  pallets: { state: LotStateKey }[],
): Partial<Record<LotStateKey, number>> {
  const out: Partial<Record<LotStateKey, number>> = {};
  for (const p of pallets) out[p.state] = (out[p.state] ?? 0) + 1;
  return out;
}

/** The hover line: "ASC-261116-01 · 700 kg · quarantine · Northgate Ingredients". */
export function palletLine(p: Pallet): string {
  return [p.code, p.qty, LOT_STATES[p.state].label, p.vendor].filter(Boolean).join(" · ");
}
