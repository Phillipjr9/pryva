import "server-only";
import { getFreshNgnRate } from "@/lib/payments/exchange-rate";
import { decimalUnits, formatDecimalUnits } from "./contract";

export type FoxreloadRate = { value: string; source: "manual" | "live" };
/** No hard-coded or stale fallback. Round the live rate upward before exact pricing. */
export async function foxreloadRate(): Promise<FoxreloadRate | null> {
  const configured = process.env.FOXRELOAD_USD_NGN_RATE?.trim();
  if (configured) {
    const units = decimalUnits(configured);
    return units !== null && units > BigInt(0) ? { value: formatDecimalUnits(units), source: "manual" } : null;
  }
  const result = await getFreshNgnRate("USD", { allowOverride: false }).catch(() => null);
  if (!result || result.source !== "live" || !Number.isFinite(result.rate) || result.rate <= 100 || result.rate > 100_000_000) return null;
  const published = Date.parse(result.fetchedAt), age = Date.now() - published;
  if (!Number.isFinite(published) || age < -300_000 || age > 36 * 60 * 60_000) return null;
  const units = Math.ceil(result.rate * 10_000);
  if (!Number.isSafeInteger(units) || units < 1) return null;
  return { value: formatDecimalUnits(BigInt(units)), source: "live" };
}
