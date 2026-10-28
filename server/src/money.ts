// Money is integer token base units (6 decimals), identical to on-chain amounts
// (DATA_MODEL.md). Only display code turns units into dollars.

export const TOKEN_DECIMALS = 6;
const UNITS_PER_DOLLAR = 10n ** BigInt(TOKEN_DECIMALS);
const UNITS_PER_CENT = UNITS_PER_DOLLAR / 100n;

/** "$5,150.00" from base units. Sub-cent remainders are an error, not rounded away. */
export function formatUsd(units: bigint): string {
  if (units % UNITS_PER_CENT !== 0n) {
    throw new RangeError(`amount ${units} has fractions of a cent`);
  }
  const negative = units < 0n;
  const cents = (negative ? -units : units) / UNITS_PER_CENT;
  const dollars = (cents / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const rest = (cents % 100n).toString().padStart(2, "0");
  return `${negative ? "-" : ""}$${dollars}.${rest}`;
}

/** Base units from "$5,150.00", "5150" or "5150.5". At most two decimal places. */
export function parseUsd(text: string): bigint {
  const match = /^(-)?\$?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/.exec(text.trim());
  if (!match) throw new SyntaxError(`not a dollar amount: "${text}"`);
  const [, sign, whole = "0", fraction = ""] = match;
  const cents = BigInt(whole.replaceAll(",", "")) * 100n + BigInt(fraction.padEnd(2, "0"));
  return (sign ? -cents : cents) * UNITS_PER_CENT;
}
