import { NextRequest, NextResponse } from "next/server";
import { requireAuthApi } from "@/lib/auth";
import { isSameOriginMutation } from "@/lib/net";

export const dynamic = "force-dynamic";

/**
 * Deleting the user currently cascades to wallets, orders, payment records and
 * issued gift cards. Do not perform it until settlement and compliant record
 * retention/anonymization are designed and implemented.
 */
export async function DELETE(request: NextRequest) {
  const user = await requireAuthApi();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  return NextResponse.json({
    error: "Self-service account deletion is temporarily unavailable. Please contact support for assistance with your account and remaining balance.",
  }, { status: 503 });
}
