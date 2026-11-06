import { NextResponse } from "next/server";

import { listPayoutAnomalies } from "@/lib/admin/payout-anomalies";
import { requireAdmin } from "@/lib/identity/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  await requireAdmin("/admin/anomalies");

  try {
    const anomalies = await listPayoutAnomalies(50);
    return NextResponse.json({ ok: true, anomalies });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load payout anomalies";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
