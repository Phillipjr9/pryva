import { digitalArtwork } from "@/lib/content/digital-artwork";
import { isNamedGiftCard } from "@/lib/services/digital-service-category";
import type { ExplorerItem } from "@/lib/services/service-explorer";

type Offer = { id: string; name: string; region: string; kind: "codes" | "topups" | "esims" };

/** Configured offers remain quotable even if they aren't on the loaded browse pages. */
export function reviewedDigitalItems(offers: readonly Offer[], starsEnabled: boolean): ExplorerItem[] {
  const items: ExplorerItem[] = offers.map((offer) => {
    const gift = offer.kind === "codes" && isNamedGiftCard(offer.name);
    const category = offer.kind === "esims" ? "esim" : offer.kind === "topups" ? "topups" : gift ? "gift-cards" : "tools";
    const label = offer.kind === "esims" ? "Travel eSIM" : offer.kind === "topups" ? "Account top-up" : gift ? "Gift card" : "Digital code · category unconfirmed";
    return {
      id: offer.id, name: offer.name, category, description: label, tag: label,
      artwork: { kind: "digital-product", art: digitalArtwork(offer.name) },
      source: "catalog", coverage: "unconfirmed", stock: null, myUnits: null, price: null,
      detail: `${offer.region} · price and availability confirmed before payment`,
      allOnly: category === "tools",
      action: { label: "Check price and availability", href: `/dashboard/digital-${offer.kind}?product=${encodeURIComponent(offer.id)}` },
    };
  });
  if (starsEnabled) items.push({
    id: "telegram-stars-featured", category: "topups", name: "Telegram Stars", description: "Account top-up", tag: "Account top-up",
    artwork: { kind: "brand", name: "telegram" }, source: "catalog", coverage: "not-country-specific", stock: null, myUnits: null, price: null,
    detail: "Price and availability confirmed before payment", action: { label: "Check price and availability", href: "/dashboard/telegram-stars" },
  });
  return items;
}
