import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/identity/auth";
import { isFleexaConfigured, getFleexaProxyCatalogue } from "@/lib/providers/fleexa";
import { financialActionsUnavailable } from "@/lib/platform/financial-environment";
import { priceFromCost } from "@/lib/services/pricing";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Live, authenticated proxy offers; supplier wholesale figures never leave the server. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  if (financialActionsUnavailable()) return NextResponse.json({ error: "Proxy plans are unavailable in this environment." }, { status: 503 });
  if (!isFleexaConfigured()) return NextResponse.json({ error: "The proxy supplier is not connected." }, { status: 503 });
  try {
    const catalogue = await getFleexaProxyCatalogue();
    return NextResponse.json({
      ok: true,
      currency: "NGN",
      expiryHours: catalogue.status.expiryHours,
      plans: catalogue.plans.map((plan) => ({
        id: plan.id,
        label: plan.label,
        quantity: plan.quantity,
        priceNgn: priceFromCost(plan.priceNgn, { service: "proxies" }).priceNgn,
      })),
      categories: catalogue.categories.map(({ id, name, description, type }) => ({ id, name, description, type })),
      countries: catalogue.countries,
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    // Provider messages and bodies may contain account details; return only safe copy.
    return NextResponse.json({ error: "Proxy plans could not be loaded right now." }, { status: 503 });
  }
}
