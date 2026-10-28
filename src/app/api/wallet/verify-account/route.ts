import { NextRequest, NextResponse } from "next/server";
import { requireAuthApi } from "@/lib/auth";
import { resolveBankAccount, isPaystackConfigured } from "@/lib/paystack";
import { isPreviewDatabase } from "@/lib/demo-policy";
import { isSameOriginMutation } from "@/lib/net";
import { logger } from "@/lib/logger";
import { readJsonWithLimit, RequestBodyTooLargeError } from "@/lib/request-body";
import { purchaseRateLimiter } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/** Verify a Nigerian bank account before adding it as a transfer recipient. */
export async function POST(request: NextRequest) {
  try {
    const user = await requireAuthApi();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Cross-origin request denied" }, { status: 403 });
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) {
      return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
    }
    if (isPreviewDatabase() || !isPaystackConfigured()) {
      return NextResponse.json({ error: "Bank transfers are unavailable in this environment." }, { status: 503 });
    }
    const limit = await purchaseRateLimiter(`bank-account-verify:${user.id}`);
    if (limit.unavailable) return NextResponse.json({ error: "Bank verification is temporarily unavailable." }, { status: 503 });
    if (!limit.allowed) return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 });
    let body: unknown;
    try {
      body = await readJsonWithLimit(request, 2_048);
    } catch (error) {
      return NextResponse.json({ error: "Invalid request body" }, { status: error instanceof RequestBodyTooLargeError ? 413 : 400 });
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    const { bankCode, accountNumber } = body as { bankCode?: unknown; accountNumber?: unknown };
    if (typeof bankCode !== "string" || !/^[a-z0-9]{1,20}$/i.test(bankCode) ||
        typeof accountNumber !== "string" || !/^\d{10}$/.test(accountNumber)) {
      return NextResponse.json({ error: "Enter a valid bank code and 10-digit account number" }, { status: 400 });
    }
    const resolved = await resolveBankAccount(accountNumber, bankCode);
    const name = typeof resolved.data?.account_name === "string" ? resolved.data.account_name.trim() : "";
    if (resolved.status !== true || resolved.data?.account_number !== accountNumber || !name || name.length > 200) {
      return NextResponse.json({ error: "Unable to verify bank account. Please check the details." }, { status: 400 });
    }
    return NextResponse.json({ ok: true, accountName: name });
  } catch {
    // Do not record provider responses or account numbers in logs.
    logger.error("Failed to verify bank account");
    return NextResponse.json({ error: "Failed to verify bank account" }, { status: 502 });
  }
}
