import "server-only";

import { getUsdToNgnRate } from "@/lib/exchange-rate";
import { logger } from "@/lib/logger";

/**
 * Turn a supplier amount into naira.
 *
 * Every supplier quotes in its own currency and we sell in naira. Only the two
 * currencies this deployment can convert honestly are accepted: a plan priced in
 * something else is refused rather than guessed at, because a wrong rate is a
 * silent loss on every sale. A missing currency is read as USD, which is what
 * both suppliers quote in.
 */
export async function supplierAmountToNgn(amount: number | null, currency: string | null): Promise<number | null> {
  if (amount === null || !Number.isFinite(amount) || amount <= 0) return null;
  const code = (currency ?? "USD").toUpperCase();
  if (code === "NGN") return Math.round(amount);
  if (code !== "USD") {
    logger.warn("Supplier price skipped: unsupported currency", { currency: code });
    return null;
  }
  const { rate } = await getUsdToNgnRate();
  const converted = Math.round(amount * rate);
  return converted > 0 ? converted : null;
}
