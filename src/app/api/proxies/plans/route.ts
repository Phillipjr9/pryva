import { NextResponse } from "next/server";
import { requireAuthApi } from "@/lib/identity/auth";
import { isFleexaConfigured, type FleexaProxyPlan } from "@/lib/providers/fleexa";
import { listFleexaProxyPlans } from "@/lib/providers/fleexa";
import { findPlan } from "@/lib/services/catalog";

export const dynamic = "force-dynamic";

/**
 * GET /api/proxies/plans
 *
 * Lists proxy plans. Live supplier listings are merged with catalogue prices:
 * the supplier provides name, region, data allowance and stock; the catalogue
 * provides the selling price. When the supplier is not configured the endpoint
 * refuses with 503 so callers know plans cannot be fetched yet.
 */
export async function GET(request: Request) {
  const user = await requireAuthApi();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isFleexaConfigured()) {
    return NextResponse.json(
      { error: "Proxy plans are not available yet." },
      { status: 503 },
    );
  }

  let supplierPlans: FleexaProxyPlan[] = [];
  let supplierError: string | null = null;

  try {
    supplierPlans = await listFleexaProxyPlans();
  } catch (error) {
    supplierError =
      error instanceof Error ? error.message : "The proxy catalogue could not be read.";
  }

  const plans = supplierPlans
    .filter((plan): plan is Required<FleexaProxyPlan> => plan.id !== null && plan.priceNgn !== null)
    .map((plan) => {
      const catalogue = findPlan(`proxy-${plan.id}`);
      const price = catalogue ? catalogue.price : plan.priceNgn ?? null;
      return {
        id: `live-proxy-${plan.id}`,
        service: "proxies",
        name: plan.name ?? `Proxy plan ${plan.id}`,
        planLabel: plan.name ?? "Proxy bandwidth",
        region: plan.region ?? "Not country-specific",
        flag: undefined,
        duration: plan.durationDays ? `${plan.durationDays} days to use` : "Validity varies",
        price,
        features: [
          `${plan.dataGb ?? 0}GB residential traffic`,
          "HTTP/SOCKS5",
          "Rotating or sticky",
        ],
        stock: plan.stock ?? null,
        priceFrom: price !== null,
        action: price !== null
          ? { label: "Buy proxy", href: `/dashboard/services/proxy/${plan.id}` }
          : null,
      };
    });

  return NextResponse.json(
    { ok: true, plans, supplierError, partial: supplierError !== null },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
