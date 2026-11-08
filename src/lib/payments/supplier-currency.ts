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
export async function supplierAmountToNgn(amount: number | null, currency: string | null): Promise<number | null> {
  if (amount === null || !Number.isFinite(amount) || amount <= 0) return null;
  const code = (currency ?? "USD").toUpperCase();
  if (code === "NGN") return Math.round(amount);

  let rate: number | null = null;
  if (code === "USD") rate = (await getUsdToNgnRate()).rate;
  else if (code === "EUR") rate = (await getFreshNgnRate("EUR"))?.rate ?? null;

  if (rate === null || !Number.isFinite(rate) || rate <= 0) {
    logger.warn("Supplier price skipped: no convertible rate", { currency: code });
    return null;
  }
  const converted = Math.round(amount * rate);
  return converted > 0 ? converted : null;
}
