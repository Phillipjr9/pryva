import Link from "next/link";
import { requireUser } from "@/lib/identity/auth";
import { findGiftCardDenomination } from "@/lib/services/gift-cards/brand-catalog";
import { legacyBrandGiftCardSalesEnabled } from "@/lib/services/gift-cards/brand-readiness";
import { GiftCardsManager } from "../GiftCardsManager";

export const dynamic = "force-dynamic";
export default async function BrandGiftCardCheckout({ searchParams }: { searchParams: Promise<{ denomination?: string | string[] }> }) {
  const params = await searchParams;
  const id = typeof params.denomination === "string" ? params.denomination : "";
  const found = findGiftCardDenomination(id);
  const next = found ? `/dashboard/gift-cards/brand?denomination=${encodeURIComponent(id)}` : "/dashboard/gift-cards/brand";
  const user = await requireUser(next);
  return <main className="mx-auto max-w-4xl space-y-6">
    <Link href="/dashboard/services?category=gift-cards" className="text-sm font-semibold text-lav-700 underline">Back to gift cards</Link>
    <h1 className="text-2xl font-bold text-ink">Review gift card</h1>
    {found ? <GiftCardsManager user={user} brandSalesEnabled={legacyBrandGiftCardSalesEnabled()} initialTab="brands" checkoutDenominationId={id} /> : <p>Gift card not found. Return to the catalogue to choose an offer.</p>}
  </main>;
}
