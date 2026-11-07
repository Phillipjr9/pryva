import { NextResponse } from "next/server";
import { requireAuthApi } from "@/lib/identity/auth";
import { isFleexaConfigured, listFleexaDataPlans } from "@/lib/providers/fleexa";
import { findPlan } from "@/lib/services/catalog";

export const dynamic = "force-dynamic";

/**
 * GET /api/airtime/plans
 *
 * Lists mobile data plans. Live supplier listings are merged with catalogue
 * prices: the supplier provides network, data allowance and stock; the
 * catalogue provides the selling price. When the supplier is not configured
 * the endpoint refuses with 503 so callers know plans cannot be fetched yet.
 */
export async function GET(request: Request) {
  const user = await requireAuthApi();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isFleexaConfigured()) {
    return NextResponse.json(
      { error: "Data plans are not available yet." },
      { status: 503 },
    );
  }

  let supplierPlans: Array<{ id: string | null; name: string | null; network: string | null; dataGb: number | null; priceNgn: number | null; durationDays: number | null; stock: number | null }> = [];
  let supplierError: string | null = null;

  try {
    supplierPlans = await listFleexaDataPlans();
  } catch (error) {
    supplierError =
      error instanceof Error ? error.message : "The data catalogue could not be read.";
  }

  const plans = supplierPlans
    .filter((plan): plan is Required<typeof supplierPlans[number]> => plan.id !== null && plan.priceNgn !== null)
    .map((plan) => {
      const catalogue = findPlan(`data-${plan.id}`);
      const price = catalogue ? catalogue.price : plan.priceNgn ?? null;
      return {
        id: `live-data-${plan.id}`,
        service: "data",
        name: plan.name ?? `Data plan ${plan.id}`,
        planLabel: plan.name ?? "Data bundle",
        region: "Nigeria",
        flag: undefined,
        duration: plan.durationDays ? `${plan.durationDays} days` : "Validity varies",
        price,
        features: [
          `${plan.dataGb ?? 0}GB`,
          plan.network ?? "Local network",
          "Instant delivery",
        ],
        stock: plan.stock ?? null,
        priceFrom: price !== null,
        action: price !== null
          ? { label: "Buy data", href: `/dashboard/services/data/${plan.id}` }
          : null,
      };
    });

  return NextResponse.json(
    { ok: true, plans, supplierError, partial: supplierError !== null },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
