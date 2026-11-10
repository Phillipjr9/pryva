import "server-only";
import { isFoxreloadConfigured, readFoxreloadProductContract } from "@/lib/providers/foxreload";
import { foxreloadRate } from "./exchange-rate";
import { priceStars, TELEGRAM_STARS_PRODUCT } from "./telegram-stars";
import { topupPrice, type TopupOffer } from "./topup-offers";

export const STAR_AMOUNTS = [50, 100, 500, 1000, 2500, 5000] as const;
const PREMIUM = [
  { months: 3, id: "product_01kn1qqhfgekgte4mbtgtc58zp", name: "Telegram Premium 3 Month" },
  { months: 6, id: "product_01kn1qqhgfe4882np8dwkwehjs", name: "Telegram Premium 6 Month" },
  { months: 12, id: "product_01kn1qqhgzfesvbxz5ver4a2mw", name: "Telegram Premium 12 Month" },
] as const;

/** Indicative only: never an order quote or proof that a product is approved. */
export async function readTelegramDisplayPrices() {
  const stars = STAR_AMOUNTS.map((quantity) => ({ quantity, amount: null as number | null }));
  const premium = PREMIUM.map(({ months }) => ({ months, amount: null as number | null }));
  if (!isFoxreloadConfigured()) return { stars, premium };
  const rate = await foxreloadRate();
  if (!rate) return { stars, premium };
  const [starProduct, ...products] = await Promise.all([
    readFoxreloadProductContract(TELEGRAM_STARS_PRODUCT).catch(() => null),
    ...PREMIUM.map((item) => readFoxreloadProductContract(item.id).catch(() => null)),
  ]);
  const env = { FOXRELOAD_USD_NGN_RATE: rate.value };
  if (starProduct) for (const row of stars) row.amount = priceStars(starProduct, row.quantity, env)?.amount ?? null;
  products.forEach((product, i) => {
    const entry = PREMIUM[i];
    if (!product || product.countryCode === undefined || product.marketRegion === undefined) return;
    const offer: TopupOffer = { id: entry.id, name: entry.name, region: "Telegram", terms: "Account top-up", countryCode: product.countryCode, marketRegion: product.marketRegion, min: 1, max: 1, fields: [{ key: "username", label: "Telegram username", type: "string" }] };
    premium[i].amount = topupPrice(product, offer, 1, env)?.amount ?? null;
  });
  return { stars, premium };
}
