import { digitalArtwork } from "@/lib/content/digital-artwork";
import type { ExplorerItem } from "@/lib/services/service-explorer";
import { BRAND_GIFT_CARDS } from "@/lib/services/gift-cards/brand-catalog";

/** The guarded legacy offers share the same shelf, but retain their own checkout. */
export function legacyGiftCardItems(enabled: boolean): ExplorerItem[] {
  if (!enabled) return [];
  return BRAND_GIFT_CARDS.flatMap((brand) => brand.denominations.map((denomination): ExplorerItem => ({
    id: `legacy-gift-${denomination.id}`,
    category: "gift-cards", name: `${brand.name} ${denomination.amountUsd} USD`,
    description: "Gift card", tag: "Gift card", detail: `${brand.region} · digital voucher`,
    artwork: { kind: "digital-product", art: digitalArtwork(brand.name) },
    source: "catalog", coverage: "unconfirmed", stock: null, myUnits: null, price: denomination.priceNgn,
    giftCardEquivalenceKey: `legacy:${brand.slug}:${brand.region}:${denomination.amountUsd}:USD`,
    action: { label: "Review gift card", href: `/dashboard/gift-cards/brand?denomination=${encodeURIComponent(denomination.id)}` },
  })));
}
