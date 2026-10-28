// Money in the ERP is integer micro-dollars (6 decimals), the same unit the rest of the repo
// and the token use, so amounts cross the connector unchanged. Quantities are integers in the
// item's base unit (mg for mass, each for counts); the API presents them in the item's unit.

export const USD = 1_000_000;
const CENT = USD / 100;

/**
 * "$5,150.00" from micro-dollars, rounded half up to the cent: inventory values carry their
 * micro-dollars (a lot's share of its cost) and only the display rounds. Negative keeps its sign.
 */
export function formatUsd(units: number | bigint): string {
  const n = BigInt(units);
  const negative = n < 0n;
  const abs = negative ? -n : n;
  const cents = (abs + BigInt(CENT) / 2n) / BigInt(CENT);
  const dollars = (cents / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}$${dollars}.${(cents % 100n).toString().padStart(2, "0")}`;
}

/** Micro-dollars from a decimal dollar amount such as 7.1 or "5150.00" (two decimals at most). */
export function usd(dollars: number | string): number {
  const text =
    typeof dollars === "number" ? dollars.toFixed(6) : dollars.trim().replace(/[$,]/g, "");
  const match = /^(-)?(\d+)(?:\.(\d{1,6}))?$/.exec(text);
  if (!match) throw new SyntaxError(`not a dollar amount: "${dollars}"`);
  const [, sign, whole = "0", fraction = ""] = match;
  const units = Number(whole) * USD + Number(fraction.padEnd(6, "0"));
  return sign ? -units : units;
}

/** Dollars as a JSON number (two decimals) for the API. */
export function dollars(units: number): number {
  return Math.round(units / CENT) / 100;
}

/** quantity (base units) × rate (micro-dollars per unit) ÷ base units per unit, half up. */
export function extend(quantityBase: number, rateUsdc: number, baseUnitsPerUnit: number): number {
  const scaled = BigInt(quantityBase) * BigInt(rateUsdc);
  const divisor = BigInt(baseUnitsPerUnit);
  return Number((scaled * 2n + divisor) / (divisor * 2n));
}

/** value × part ÷ whole, half up; the share of a balance that a quantity carries. */
export function proRata(value: number, part: number, whole: number): number {
  if (whole === 0) return 0;
  const scaled = BigInt(value) * BigInt(part);
  const divisor = BigInt(whole);
  const sign = scaled < 0n ? -1n : 1n;
  const abs = scaled < 0n ? -scaled : scaled;
  return Number((sign * (abs * 2n + divisor)) / (divisor * 2n));
}

/** Quantity in the item's unit as a JSON number: 700 kg from 700,000,000 mg. */
export function quantity(base: number, baseUnitsPerUnit: number): number {
  return baseUnitsPerUnit === 1 ? base : Math.round((base / baseUnitsPerUnit) * 1e6) / 1e6;
}

/** Base units from a quantity in the item's unit. */
export function toBase(qty: number, baseUnitsPerUnit: number): number {
  return Math.round(qty * baseUnitsPerUnit);
}
