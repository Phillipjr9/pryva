import { NextResponse } from "next/server";
import { requireAuthApi } from "@/lib/identity/auth";
import { isFleexaConfigured, listFleexaSubscriptionPlans } from "@/lib/providers/fleexa";
import { findPlan } from "@/lib/services/catalog";

export const dynamic = "force-dynamic";

/**
 * GET /api/subscriptions/plans
 *
 * Lists subscription plans. Live supplier listings are merged with catalogue
 * prices: the supplier provides name, region and stock; the catalogue provides
 * the selling price. When the supplier is not configured the endpoint refuses
 * with 503 so callers know plans cannot be fetched yet.
 */
export async function GET(request: Request) {
  const user = await requireAuthApi();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isFleexaConfigured()) {
    return NextResponse.json(
      { error: "Subscription plans are not available yet." },
      { status: 503 },
    );
  }

  let supplierPlans: Array<{ id: string | null; name: string | null; region: string | null; priceNgn: number | null; durationDays: number | null; stock: number | null }> = [];
  let supplierError: string | null = null;

  try {
    supplierPlans = await listFleexaSubscriptionPlans();
  } catch (error) {
    supplierError =
      error instanceof Error ? error.message : "The subscription catalogue could not be read.";
  }

  const plans = supplierPlans
    .filter((plan): plan is Required<typeof supplierPlans[number]> => plan.id !== null && plan.priceNgn !== null)
    .map((plan) => {
      const catalogue = findPlan(`sub-${plan.id}`);
      const price = catalogue ? catalogue.price : plan.priceNgn ?? null;
      return {
        id: `live-sub-${plan.id}`,
        service: "subscriptions",
        name: plan.name ?? `Subscription ${plan.id}`,
        planLabel: plan.name ?? "Subscription",
        region: plan.region ?? "Not country-specific",
        flag: undefined,
        duration: plan.durationDays ? `${plan.durationDays} days` : "Validity varies",
        price,
        features: [
          "Instant activation",
          "Renews monthly",
        ],
        stock: plan.stock ?? null,
        priceFrom: price !== null,
        action: price !== null
          ? { label: "Buy subscription", href: `/dashboard/services/subscription/${plan.id}` }
          : null,
      };
    });

  return NextResponse.json(
    { ok: true, plans, supplierError, partial: supplierError !== null },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
