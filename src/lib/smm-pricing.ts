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
 *   • `SMM_MARKUP_PERCENT` is the margin. It defaults to 35 % and is an owner
 *     setting, not a guess made in a request handler.
 *   • `SMM_USD_NGN_RATE` converts a USD-billing supplier into naira. It has **no
 *     default**: converting with an invented exchange rate is how a platform
 *     quietly loses money every time the naira moves, so a USD panel without a
 *     configured rate simply has no price and cannot be bought.
 *   • Prices are whole naira, rounded up. Never round a customer's total down.
 *
 * The wholesale rate itself never leaves the server: the browser is told the
 * retail price per 1,000 and multiplies by the quantity it is buying.
 */

/** Owner setting, in percent. 35 % keeps a boost profitable after fees. */
export const SMM_MARKUP_PERCENT_DEFAULT = 35;

/** Guard rails: a 0 % margin is reselling at cost, and 400 % is a typo. */
const MIN_MARKUP_PERCENT = 0;
const MAX_MARKUP_PERCENT = 400;

export function smmMarkupPercent(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.SMM_MARKUP_PERCENT?.trim());
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

/**
 * Retail price of 1,000 units, in whole naira, or null when it cannot be
 * computed honestly (no wholesale rate, unknown currency, or a USD panel with
 * no configured conversion rate).
 */
export function retailPerThousand(input: {
  wholesaleRatePerThousand: number | null;
  currency: string | null;
  env?: NodeJS.ProcessEnv;
}): number | null {
  const rate = input.wholesaleRatePerThousand;
  if (rate === null || !Number.isFinite(rate) || rate <= 0) return null;
  const currency = normalizeCurrency(input.currency);
  if (!currency) return null;

  let naira = rate;
  if (currency === "USD") {
    const fx = smmUsdNgnRate(input.env);
    if (!fx) return null;
    naira = rate * fx;
  }

  const markup = smmMarkupPercent(input.env);
  return Math.max(1, Math.ceil(naira * (1 + markup / 100)));
}

/** What a specific quantity costs at a given retail price per 1,000. */
export function totalForQuantity(perThousand: number, quantity: number): number {
  if (!Number.isSafeInteger(quantity) || quantity <= 0) return 0;
  if (!Number.isFinite(perThousand) || perThousand <= 0) return 0;
  return Math.ceil((perThousand * quantity) / 1_000);
}
