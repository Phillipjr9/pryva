import { NextRequest, NextResponse } from "next/server";
import { checkGiftCardBalance } from "@/lib/gift-cards";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const code = request.nextUrl.searchParams.get("code");

    if (!code) {
      return NextResponse.json({ error: "Code parameter required" }, { status: 400 });
    }

    const result = await checkGiftCardBalance(code.trim().toUpperCase());

    if (!result) {
      return NextResponse.json({ error: "Gift card not found" }, { status: 404 });
    }

    return NextResponse.json({
      ok: true,
      amount: result.amount,
      status: result.status,
      expiresAt: result.expiresAt.toISOString(),
    });
  } catch (error) {
    console.error("Gift card check failed:", error);
    return NextResponse.json({ error: "Check failed" }, { status: 500 });
  }
}
