// The plant's catalogue as the ledger holds it (docs/VISION.md §6.12.2): every product with its
// active formula and where it is made, and every supplier with its standing and what it is
// approved to supply. What the integration program asks Linda and Jordan to confirm.

import { and, asc, eq } from "drizzle-orm";
import type { LedgerDb } from "./events.ts";
import {
  batchRecords,
  facilities,
  formulaLines,
  formulas,
  materials,
  productionPlan,
  products,
  vendorMaterials,
  vendors,
} from "./schema.ts";

export interface CatalogProduct {
  code: string;
  name: string;
  /** Tablet, capsule or powder, from how its batches are numbered at the plant. */
  form: "Tablets" | "Capsules" | "Powder";
  batchUnits: number;
  unitWeightMg: number;
  /** The plants that made it or plan to. */
  plants: string[];
  lines: { material: string; name: string; qtyPerBatchBase: number; overageBp: number }[];
}
export interface CatalogVendor {
  code: string;
  name: string;
  qualification: string;
  account: string | null;
  notes: string | null;
  supplies: { material: string; name: string; approved: boolean }[];
}

export function catalog(db: LedgerDb): { products: CatalogProduct[]; vendors: CatalogVendor[] } {
  const made = new Map<number, { plants: Set<string>; prefixes: Set<string> }>();
  const note = (productId: number, plant: string, batchNo: string) => {
    const m = made.get(productId) ?? { plants: new Set(), prefixes: new Set() };
    m.plants.add(plant);
    m.prefixes.add(batchNo.slice(0, 2));
    made.set(productId, m);
  };
  for (const b of db
    .select({
      productId: batchRecords.productId,
      plant: facilities.code,
      batchNo: batchRecords.batchNo,
    })
    .from(batchRecords)
    .innerJoin(facilities, eq(facilities.id, batchRecords.facilityId))
    .all()) {
    note(b.productId, b.plant, b.batchNo);
  }
  for (const p of db
    .select({
      productId: productionPlan.productId,
      plant: facilities.code,
      batchNo: productionPlan.batchNo,
    })
    .from(productionPlan)
    .innerJoin(facilities, eq(facilities.id, productionPlan.facilityId))
    .all()) {
    note(p.productId, p.plant, p.batchNo);
  }

  const productRows = db.select().from(products).orderBy(asc(products.code)).all();
  const out: CatalogProduct[] = productRows.map((p) => {
    const lines = db
      .select({
        material: materials.code,
        name: materials.name,
        qty: formulaLines.qtyPerBatchBase,
        overage: formulaLines.overageBp,
      })
      .from(formulaLines)
      .innerJoin(
        formulas,
        and(eq(formulas.id, formulaLines.formulaId), eq(formulas.status, "active")),
      )
      .innerJoin(materials, eq(materials.id, formulaLines.materialId))
      .where(eq(formulas.productId, p.id))
      .orderBy(asc(formulaLines.id))
      .all();
    const m = made.get(p.id);
    const prefix = m && [...m.prefixes][0];
    return {
      code: p.code,
      name: p.name,
      form: prefix === "BC" ? "Capsules" : prefix === "BP" ? "Powder" : "Tablets",
      batchUnits: p.standardBatchTablets,
      unitWeightMg: p.tabletWeightMg,
      plants: [...(m?.plants ?? [])].sort(),
      lines: lines.map((l) => ({
        material: l.material,
        name: l.name,
        qtyPerBatchBase: l.qty,
        overageBp: l.overage,
      })),
    };
  });

  const vendorRows = db.select().from(vendors).orderBy(asc(vendors.name)).all();
  const supplied = db
    .select({
      vendorId: vendorMaterials.vendorId,
      material: materials.code,
      name: materials.name,
      approved: vendorMaterials.approvedSource,
    })
    .from(vendorMaterials)
    .innerJoin(materials, eq(materials.id, vendorMaterials.materialId))
    .orderBy(asc(materials.code))
    .all();
  return {
    products: out,
    vendors: vendorRows.map((v) => ({
      code: v.code,
      name: v.name,
      qualification: v.qualificationStatus,
      account: v.nearAccountId,
      notes: v.notes,
      supplies: supplied
        .filter((s) => s.vendorId === v.id)
        .map((s) => ({ material: s.material, name: s.name, approved: Boolean(s.approved) })),
    })),
  };
}
