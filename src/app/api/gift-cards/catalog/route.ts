import { NextResponse } from "next/server";
import { getBrandGiftCards } from "@/lib/services/gift-cards/brand-catalog";
import { legacyBrandGiftCardSalesEnabled } from "@/lib/services/gift-cards/brand-readiness";

export const dynamic = "force-dynamic";

export async function GET() {
  const cards = getBrandGiftCards();
  return NextResponse.json({
    ok: true,
    cards,
    liveFulfillmentConfigured: legacyBrandGiftCardSalesEnabled(),
  });
}
