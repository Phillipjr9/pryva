/**
 * Retail pricing for boosting.
 *
 * The supplier quotes a wholesale rate per 1,000 units, in its own billing
 * currency. Until now the catalog deliberately left `price` null because that
 * rate plus a margin is a business decision, and inventing one per request is
 * how a platform sells below cost. This module makes the decision explicit and
 * puts it in one place:
 *
 *   retail per 1,000 = ceil(wholesale × (1 + margin) × fx)
 *
 *   • `SMM_MARKUP_PERCENT` is a markup on cost, not a gross margin on the
 *     selling price. It defaults to 35 % and is an owner setting.
 *   • USD conversion uses an explicit `SMM_USD_NGN_RATE` funding-rate pin,
 *     otherwise a validated shared purchase quote. With neither, the listing
 *     has no price and cannot be bought; no fixed fallback is invented.
 *   • Prices are whole naira, rounded up. Never round a customer's total down.
 *
 * The wholesale rate itself never leaves the server: the browser is told the
 * retail price per 1,000 and multiplies by the quantity it is buying.
 */

export { totalForQuantity } from "@/lib/services/boosts/boost-money";

/** Owner setting, in percent. Costs, funding rates and fees must still be checked. */
export const SMM_MARKUP_PERCENT_DEFAULT = 35;

/** Guard rails: a 0 % margin is reselling at cost, and 400 % is a typo. */
const MIN_MARKUP_PERCENT = 0;
const MAX_MARKUP_PERCENT = 400;

export function smmMarkupPercent(env: NodeJS.ProcessEnv = process.env): number {
  const setting = env.SMM_MARKUP_PERCENT?.trim();
  if (!setting) return SMM_MARKUP_PERCENT_DEFAULT;
  const raw = Number(setting);
  if (!Number.isFinite(raw)) return SMM_MARKUP_PERCENT_DEFAULT;
  return Math.min(Math.max(raw, MIN_MARKUP_PERCENT), MAX_MARKUP_PERCENT);
}

/**
 * Naira per US dollar for a USD-billing supplier. Required for those panels;
 * deliberately absent by default rather than seeded with a stale figure.
 */
export function smmUsdNgnRate(env: NodeJS.ProcessEnv = process.env): number | null {
  const raw = Number(env.SMM_USD_NGN_RATE?.trim());
  return Number.isFinite(raw) && raw > 0 ? raw : null;
}

/** The panel's billing currency for a service, normalised, or null. */
export function normalizeCurrency(value: string | null | undefined): "NGN" | "USD" | null {
  const code = (value ?? "").trim().toUpperCase();
  if (["NGN", "N", "₦"].includes(code)) return "NGN";
  if (["USD", "US$", "$"].includes(code)) return "USD";
  return null;
}

/** Represent the decimal a number describes exactly, including scientific notation. */
function decimalRatio(value: number): { numerator: bigint; denominator: bigint } | null {
  if (!Number.isFinite(value) || value < 0) return null;
  const [coefficient, exponentText = "0"] = value.toString().toLowerCase().split("e");
  const [whole, fraction = ""] = coefficient.split(".");
  const power = Number(exponentText) - fraction.length;
  const digits = BigInt(`${whole}${fraction}`);
  return power >= 0
    ? { numerator: digits * BigInt(10) ** BigInt(power), denominator: BigInt(1) }
    : { numerator: digits, denominator: BigInt(10) ** BigInt(-power) };
}

/**
 * Retail price of 1,000 units, in whole naira, or null when it cannot be
 * computed honestly (no wholesale rate, unknown currency, or a USD panel with
 * no configured conversion rate).
 */
export function retailPerThousand(input: {
  wholesaleRatePerThousand: number | null;
  currency: string | null;
  /** Already-resolved purchase FX; undefined keeps the legacy pure-function pin. */
  usdNgnRate?: number | null;
  env?: NodeJS.ProcessEnv;
}): number | null {
  const rate = input.wholesaleRatePerThousand;
  if (rate === null || !Number.isFinite(rate) || rate <= 0) return null;
  const currency = normalizeCurrency(input.currency);
  if (!currency) return null;

  const fx = currency === "USD"
    ? input.usdNgnRate === undefined ? smmUsdNgnRate(input.env) : input.usdNgnRate
    : 1;
  if (fx === null || !Number.isFinite(fx) || fx <= 0) return null;
  const wholesale = decimalRatio(rate);
  const conversion = decimalRatio(fx);
  const markup = decimalRatio(smmMarkupPercent(input.env));
  if (!wholesale || !conversion || !markup) return null;

  // Floating-point multiplication can produce 243.00000000000003 for the
  // exact calculation 180 × 1.35; Math.ceil would wrongly charge ₦244. Work
  // with decimal fractions instead, and round up only once at the end.
  const numerator = wholesale.numerator * conversion.numerator * (BigInt(100) * markup.denominator + markup.numerator);
  const denominator = wholesale.denominator * conversion.denominator * BigInt(100) * markup.denominator;
  const retail = (numerator + denominator - BigInt(1)) / denominator;
  if (retail <= BigInt(0) || retail > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(retail);
}
