/**
 * Money parsing for supplier prices — SERVER ONLY.
 *
 * Suppliers disagree about how they send money. One sends a two-decimal string
 * ("0.44"); another sends a float with five decimals (0.06992). Float
 * arithmetic on either accumulates error, so every supplier price is parsed
 * into integers here:
 *
 *   • `usdMicros()`          keeps the full published precision (1 USD = 1e6 micro).
 *   • `usdCents()`           rounds to whole cents for the pricing engine.
 *   • `usdCents(value, dir)` picks the rounding direction deliberately.
 *
 * Rounding direction matters because it moves money:
 *   • A **cost** rounds *up*. Overstating what we paid by a fraction of a cent
 *     can only raise the margin floor, never lower it.
 *   • A **discount** rounds *down*. Overstating a discount would shrink the
 *     customer's charge and could push a basket under the profit floor.
 *
 * Nothing here knows which supplier sent the value; that keeps the parser
 * reusable and keeps supplier identity out of modules the routes share.
 */

import "server-only";

/** $1,000,000 in micro-USD. Anything larger is a parsing bug, not a price. */
const MAX_USD_MICROS = 1_000_000_000_000;

export class SupplierMoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SupplierMoneyError";
  }
}

/**
 * Parse a supplier price into integer micro-USD.
 *
 * Accepts a number or a decimal string. Digits beyond the sixth decimal place
 * are not silently dropped: any non-zero remainder rounds the magnitude up by
 * one micro, so a cost is never understated.
 */
export function usdMicros(value: string | number): number {
  // `toFixed` avoids exponent notation ("1e-7") for numbers, which the decimal
  // regex below would otherwise reject.
  const raw = typeof value === "number"
    ? Number.isFinite(value) ? value.toFixed(6) : ""
    : String(value).trim();

  const match = /^(-?)(\d{1,9})(?:\.(\d+))?$/.exec(raw);
  if (!match) throw new SupplierMoneyError("Unparseable money value");

  const [, sign, whole, fraction = ""] = match;
  const digits = fraction.slice(0, 6).padEnd(6, "0");
  const remainder = fraction.slice(6);

  let micros = Number(whole) * 1_000_000 + Number(digits);
  if (/[1-9]/.test(remainder)) micros += 1;
  if (sign === "-") micros = -micros;

  if (!Number.isSafeInteger(micros) || Math.abs(micros) > MAX_USD_MICROS) {
    throw new SupplierMoneyError("Money value out of range");
  }
  return micros;
}

/** Micro-USD → integer cents, rounding the magnitude up or down as asked. */
export function usdCentsFromMicros(micros: number, direction: "up" | "down" = "up"): number {
  if (!Number.isSafeInteger(micros)) throw new SupplierMoneyError("Money value out of range");
  const sign = micros < 0 ? -1 : 1;
  const magnitude = Math.abs(micros);
  const cents = direction === "up" ? Math.ceil(magnitude / 10_000) : Math.floor(magnitude / 10_000);
  return sign * cents;
}

/**
 * Parse a supplier price straight into integer cents.
 *
 * Defaults to rounding up, which is the safe direction for a cost. Pass
 * `"down"` for a discount so a sub-cent reduction cannot be inflated.
 */
export function usdCents(value: string | number, direction: "up" | "down" = "up"): number {
  return usdCentsFromMicros(usdMicros(value), direction);
}

/** Integer micro-USD → canonical six-decimal string, with no float round trip. */
export function usdStringFromMicros(micros: number): string {
  if (!Number.isSafeInteger(micros)) throw new SupplierMoneyError("Money value out of range");
  const sign = micros < 0 ? "-" : "";
  const magnitude = Math.abs(micros);
  const whole = Math.floor(magnitude / 1_000_000);
  const fraction = String(magnitude % 1_000_000).padStart(6, "0");
  return `${sign}${whole}.${fraction}`;
}

/** Normalise a supplier price to a canonical six-decimal string. */
export function usdString(value: string | number): string {
  return usdStringFromMicros(usdMicros(value));
}
