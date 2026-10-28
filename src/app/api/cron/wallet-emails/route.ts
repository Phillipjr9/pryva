import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { isPreviewDatabase } from "@/lib/demo-policy";
import { dispatchWalletEmails, walletEmailConfigured } from "@/lib/wallet-email-outbox";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(value: string | null): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || !value) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const provided = Buffer.from(value);
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}

export async function GET(request: NextRequest) {
  if (!authorized(request.headers.get("authorization"))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (isPreviewDatabase() || !walletEmailConfigured()) return NextResponse.json({ error: "Wallet email worker is unavailable" }, { status: 503 });
  try {
    const counts = await dispatchWalletEmails();
    return NextResponse.json({ ok: true, ...counts }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    logger.error("Wallet email worker failed");
    return NextResponse.json({ error: "Email worker failed" }, { status: 500 });
  }
}

export const POST = GET;
