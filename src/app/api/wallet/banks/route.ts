import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getBanks } from "@/lib/paystack";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * GET /api/wallet/banks
 * Get list of Nigerian banks for withdrawal form
 */
export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Fetch banks from Paystack
    const banks = await getBanks();

    // Sort alphabetically by name
    const sortedBanks = banks.sort((a, b) => a.name.localeCompare(b.name));

    return NextResponse.json({
      ok: true,
      banks: sortedBanks,
      count: sortedBanks.length,
    });
  } catch (error) {
    logger.error("Failed to fetch banks:", { error });
    return NextResponse.json(
      { error: "Failed to fetch banks list" },
      { status: 500 }
    );
  }
}
