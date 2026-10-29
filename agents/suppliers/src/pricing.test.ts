import { SUPPLIERS } from "@day-one/server/seed/quotes";
import { describe, expect, it } from "vitest";
import { priceFor, VOLUME_BREAKS } from "./pricing.ts";

const KG = 1_000_000;
const northgate = SUPPLIERS.find((s) => s.vendor === "NGI");
const bayfront = SUPPLIERS.find((s) => s.vendor === "BLS");
if (!northgate || !bayfront) throw new Error("seed suppliers missing");

describe("volume pricing", () => {
  it("quotes the list price below every break, so the 700 kg demo RFQ is unchanged", () => {
    expect(priceFor(northgate, "ASC", 700 * KG)).toEqual(northgate.prices.ASC);
    expect(priceFor(northgate, "ASC", 999_999_999)).toEqual(northgate.prices.ASC);
  });

  it("drops to the break price from the break quantity, keeping freight and lead time", () => {
    expect(priceFor(northgate, "ASC", 1_000 * KG)).toEqual({
      unitPrice: 6.65,
      leadTimeDays: 7,
      freight: 180,
    });
    expect(priceFor(northgate, "ASC", 1_400 * KG)?.unitPrice).toBe(6.65);
  });

  it("takes the deepest break reached when a supplier lists several", () => {
    const breaks = {
      [northgate.account]: {
        ASC: [
          { minQtyBase: 2_000 * KG, unitPrice: 6.2 },
          { minQtyBase: 1_000 * KG, unitPrice: 6.65 },
        ],
      },
    };
    expect(priceFor(northgate, "ASC", 1_500 * KG, breaks)?.unitPrice).toBe(6.65);
    expect(priceFor(northgate, "ASC", 2_000 * KG, breaks)?.unitPrice).toBe(6.2);
  });

  it("gives no price for a material the supplier does not sell, and no break for one not listed", () => {
    expect(priceFor(northgate, "ACN", 1_000 * KG)).toBeNull();
    expect(priceFor(bayfront, "ACN", 1_000_000)).toEqual(bayfront.prices.ACN);
    expect(VOLUME_BREAKS[bayfront.account]).toBeUndefined();
  });
});
