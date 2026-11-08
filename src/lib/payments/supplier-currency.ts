import "server-only";

import { getFreshNgnRate, getUsdToNgnRate } from "@/lib/payments/exchange-rate";
import { logger } from "@/lib/platform/logger";

/**
 * Turn a supplier amount into naira.
 *
 * Every supplier quotes in its own currency and we sell in naira. Only the
 * currencies this deployment can convert honestly are accepted: a price in
 * something else is refused rather than guessed at, because a wrong rate is a
 * silent loss on every sale. A missing currency is read as USD, which is what
 * the marketplace quotes in.
 *
 * EUR matters because Bitcall settles in it: an offer priced in euros that we
 * cannot convert is an offer we cannot list with a price at all. It therefore
 * uses the same validated quote rate as an eSIM purchase, which is refused
 * rather than carried on a stale fallback.
 */

/** The currency an amount is denominated in; a missing one means USD. */
export function supplierCurrencyCode(currency: string | null): string {
  return (currency ?? "USD").toUpperCase();
}

/** NGN per one unit of `code`, or null when this deployment cannot convert it. */
async function ngnRateFor(code: string): Promise<number | null> {
  if (code === "NGN") return 1;
  if (code === "USD") return (await getUsdToNgnRate()).rate;
  if (code === "EUR") return (await getFreshNgnRate("EUR"))?.rate ?? null;
  return null;
}

/**
 * NGN per unit for every currency a catalogue read needs, resolved once per
 * code and concurrently.
 *
 * A catalogue prices hundreds of offers in one currency, so converting them one
 * at a time turned a single rate lookup into a serial queue behind the whole
 * listing. Worse, that queue ran *after* the catalogue read had already spent
 * most of its budget, so a slow rate feed could exhaust the budget on its own
 * and the catalogue came back empty. Resolving the distinct codes once, in
 * parallel, is what lets both reads share one deadline.
 */
export async function supplierNgnRates(currencies: (string | null)[]): Promise<Map<string, number | null>> {
  const codes = [...new Set(currencies.map(supplierCurrencyCode))];
  const entries = await Promise.all(codes.map(async (code) => [code, await ngnRateFor(code)] as const));
  return new Map(entries);
}

/**
 * Convert with a table that is already resolved, so a loop over hundreds of
 * offers stays synchronous and does no further I/O.
 */
export function supplierAmountWithRates(
  amount: number | null,
  currency: string | null,
  rates: Map<string, number | null>,
): number | null {
  if (amount === null || !Number.isFinite(amount) || amount <= 0) return null;
  const code = supplierCurrencyCode(currency);
  if (code === "NGN") return Math.round(amount);

  const rate = rates.get(code) ?? null;
  if (rate === null || !Number.isFinite(rate) || rate <= 0) {
    logger.warn("Supplier price skipped: no convertible rate", { currency: code });
    return null;
  }
  const converted = Math.round(amount * rate);
  return converted > 0 ? converted : null;
}

/** One amount, on its own. For callers that are not looping over a catalogue. */
export async function supplierAmountToNgn(amount: number | null, currency: string | null): Promise<number | null> {
  if (amount === null || !Number.isFinite(amount) || amount <= 0) return null;
  const rates = await supplierNgnRates([currency]);
  return supplierAmountWithRates(amount, currency, rates);
}
