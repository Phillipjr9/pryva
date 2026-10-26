import { NextResponse } from "next/server";
import { hasDatabase } from "@/db";
import { isPaystackConfigured, settleWalletTopup } from "@/lib/paystack";

export const dynamic = "force-dynamic";

function safeReturnTo(value: string | null, origin: string): string | null {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\") || value.length > 600) {
    return null;
  }
  try {
    const target = new URL(value, origin);
    if (target.origin !== origin) return null;
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return null;
  }
}

function walletRedirect(request: Request, funding: string, reference?: string, returnTo?: string | null) {
  const destination = new URL("/dashboard/wallet", request.url);
  destination.searchParams.set("funding", funding);
  if (reference) destination.searchParams.set("reference", reference);
  if (returnTo) destination.searchParams.set("returnTo", returnTo);
  return NextResponse.redirect(destination, 303);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const reference = url.searchParams.get("reference") ?? url.searchParams.get("trxref");
  const returnTo = safeReturnTo(url.searchParams.get("returnTo"), url.origin);
  if (!reference || !/^[a-z\d-]{1,40}$/i.test(reference)) {
    return walletRedirect(request, "failed", undefined, returnTo);
  }
  if (!hasDatabase || !isPaystackConfigured()) {
    return walletRedirect(request, "pending", reference, returnTo);
  }

  try {
    // Ignore any status supplied by the browser redirect. Only a server-side
    // Paystack verification can mark this top-up paid and credit the wallet.
    const result = await settleWalletTopup(reference);
    const funding =
      result.status === "paid"
        ? "success"
        : result.status === "pending"
          ? "pending"
          : "failed";
    return walletRedirect(request, funding, reference, returnTo);
  } catch (error) {
    console.error("Paystack callback verification failed", error);
    return walletRedirect(request, "pending", reference, returnTo);
  }
}
