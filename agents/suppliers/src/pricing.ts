// Volume pricing for the supplier agents (FICTIONAL_DATA §16). A price list line holds the
// single-plant price; a supplier that gives a break for pooled volume lists it here, by
// account and material, as the quantity (in the material's base unit) from which the lower
// unit price applies. Freight and lead time do not change with volume. Below every break the
// agent quotes its list price, so the main demo's 700 kg RFQ is priced exactly as before.

import type { PriceLine, SupplierSpec } from "@day-one/server/seed/quotes";

export interface VolumeBreak {
  /** The quantity, in base units (mg for mass), from which `unitPrice` applies. */
  minQtyBase: number;
  /** Dollars per inventory unit at or above `minQtyBase`. */
  unitPrice: number;
}

const KG = 1_000_000;

/** Breaks by supplier account, then material code. Suppliers not listed give none. */
export const VOLUME_BREAKS: Readonly<
  Record<string, Readonly<Record<string, readonly VolumeBreak[]>>>
> = {
  // Northgate drops 45 cents a kilo from 1,000 kg.
  "northgate-ingredients.testnet": { ASC: [{ minQtyBase: 1_000 * KG, unitPrice: 6.65 }] },
  // Ridgeway drops 55 cents from 1,000 kg: still the dearer landed cost at the pooled volume.
  "ridgeway-ascorbics.testnet": { ASC: [{ minQtyBase: 1_000 * KG, unitPrice: 6.8 }] },
  // QuickChem undercuts everyone at any volume and is still not a qualified vendor.
  "quickchem-direct.testnet": { ASC: [{ minQtyBase: 1_000 * KG, unitPrice: 5.4 }] },
};

/** The supplier's price line for `qtyBase` of `material`: the best break reached, else the list price. */
export function priceFor(
  spec: Pick<SupplierSpec, "account" | "prices">,
  material: string,
  qtyBase: number,
  breaks = VOLUME_BREAKS,
): PriceLine | null {
  const list = spec.prices[material];
  if (!list) return null;
  const reached = (breaks[spec.account]?.[material] ?? [])
    .filter((b) => qtyBase >= b.minQtyBase)
    .sort((a, b) => b.minQtyBase - a.minQtyBase)[0];
  return reached ? { ...list, unitPrice: reached.unitPrice } : list;
}
