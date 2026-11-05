import { NextResponse } from "next/server";
import { getBrandGiftCards } from "@/lib/services/gift-cards/gift-cards-catalog";
import { isFoxreloadConfigured } from "@/lib/providers/foxreload";

export const dynamic = "force-dynamic";

export async function GET() {
  const cards = getBrandGiftCards();
  return NextResponse.json({
    ok: true,
    cards,
    liveFulfillmentConfigured: isFoxreloadConfigured(),
  });
}
