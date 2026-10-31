import { NextResponse } from "next/server";
import { getBrandGiftCards } from "@/lib/gift-cards-catalog";
import { isFoxreloadConfigured } from "@/lib/foxreload";

export const dynamic = "force-dynamic";

export async function GET() {
  const cards = getBrandGiftCards();
  return NextResponse.json({
    ok: true,
    cards,
    liveSupplierConfigured: isFoxreloadConfigured(),
  });
}
