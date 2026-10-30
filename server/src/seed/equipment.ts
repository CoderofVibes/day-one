// The equipment in each area (docs/VISION.md §6.5.3, §6.12.1), fictional like everything in the
// seed: one to four pieces per area, named the way the plant floor names them. Reference data the
// area sheet lists; each piece's status comes from the ledger (server/src/ledger/areas.ts), and
// there is no maintenance history (cut in §6.8: nothing else in the product would use one).

import type { DEPARTMENTS } from "../ledger/schema.ts";

export type AreaCode = (typeof DEPARTMENTS)[number];

export interface Equipment {
  id: string;
  name: string;
}

export const EQUIPMENT: Record<AreaCode, Equipment[]> = {
  receiving: [
    { id: "D1", name: "Dock 1, leveler" },
    { id: "D2", name: "Dock 2, leveler" },
    { id: "FS-1", name: "Floor scale, 3,000 kg" },
  ],
  quarantine: [{ id: "QC-CAGE", name: "Quarantine cage, 24 pallet places" }],
  rm_storage: [
    { id: "R1-R6", name: "Pallet racking, six bays" },
    { id: "RT-1", name: "Reach truck" },
  ],
  pkg_storage: [{ id: "P1-P4", name: "Packaging racking, four bays" }],
  fg_storage: [{ id: "F1-F4", name: "Finished goods racking, four bays" }],
  shipping: [
    { id: "D4", name: "Dock 4, outbound" },
    { id: "SW-1", name: "Stretch wrapper" },
  ],
  rm_staging: [{ id: "DS-1", name: "Dispensary store, batch kits" }],
  weigh_cells: [
    { id: "W1", name: "Weigh cell 1, downflow booth" },
    { id: "W2", name: "Weigh cell 2, downflow booth" },
    { id: "W3", name: "Weigh cell 3, downflow booth" },
    { id: "W4", name: "Weigh cell 4, downflow booth" },
  ],
  formulation: [
    { id: "B1", name: "Blending suite 1, 2,000 L bin blender" },
    { id: "B2", name: "Blending suite 2, 1,200 L bin blender" },
    { id: "B3", name: "Blending suite 3, ribbon blender (powders)" },
  ],
  tableting: [
    { id: "T1", name: "Tablet press 1, 36 stations" },
    { id: "T2", name: "Tablet press 2, 36 stations" },
    { id: "T3", name: "Tablet press 3, 24 stations" },
    { id: "C1", name: "Capsule filler" },
  ],
  bulk_hold: [{ id: "BH-1", name: "Bulk hold room, 40 drums" }],
  bottling: [
    { id: "L1", name: "Bottling line 1: counter, capper, induction sealer" },
    { id: "L2", name: "Bottling line 2: counter, capper, induction sealer" },
  ],
  labeling: [{ id: "LB-1", name: "Wrap labeler" }],
  cartoning: [
    { id: "K1", name: "Cartoner" },
    { id: "CP-1", name: "Case packer" },
  ],
  palletizing: [{ id: "PZ-1", name: "Palletizer" }],
  powder_fill: [{ id: "PF-1", name: "Canister filler and seamer" }],
  qc_lab: [
    { id: "HPLC-1", name: "HPLC 1" },
    { id: "HPLC-2", name: "HPLC 2" },
    { id: "DS-6", name: "Dissolution bath, six vessels" },
    { id: "BAL-1", name: "Analytical balance" },
  ],
  purchasing: [],
  planning: [],
  accounting: [],
};
