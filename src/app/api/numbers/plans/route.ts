import { NextResponse } from "next/server";
import { requireAuthApi } from "@/lib/identity/auth";
import { isFleexaConfigured, listFleexaSmsServices } from "@/lib/providers/fleexa";
import { findPlan, plans } from "@/lib/services/catalog";
import { isPlanFulfillable, fulfilmentIntent } from "@/lib/services/fulfillment";

export const dynamic = "force-dynamic";

/**
 * GET /api/numbers/plans
 *
 * Lists virtual number plans. Catalogue plans are the source of truth for
 * slugs, names, regions and selling prices; the supplier feed tells us which
 * destinations currently have coverage and stock. When Fleexa is not configured
 * the endpoint refuses with 503 so callers know plans cannot be confirmed yet.
 */
export async function GET(request: Request) {
  const user = await requireAuthApi();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isFleexaConfigured()) {
    return NextResponse.json(
      { error: "Number plans are not available yet." },
      { status: 503 },
    );
  }

  let supplierServices: Awaited<ReturnType<typeof listFleexaSmsServices>> = [];
  try {
    supplierServices = await listFleexaSmsServices();
  } catch {
    supplierServices = [];
  }

  // Index supplier offers by country so a plan can say whether its destination
  // is currently covered and in stock. Multiple offers may cover one country;
  // we keep the cheapest priced one and the best stock signal.
  const byCountry = new Map<string, { priceNgn: number | null; stock: number | null }>();
  for (const service of supplierServices) {
    const country = service.country;
    if (!country) continue;
    const key = country.toLowerCase();
    const existing = byCountry.get(key);
    const priced = service.priceNgn !== null;
    if (!existing) {
      byCountry.set(key, { priceNgn: service.priceNgn, stock: service.stock });
      continue;
    }
    // Keep the cheapest priced offer; stock is "unknown" if any source says so.
    if (priced && (existing.priceNgn === null || service.priceNgn! < existing.priceNgn)) {
      existing.priceNgn = service.priceNgn;
    }
    if (existing.stock === null || (service.stock !== null && service.stock > 0)) {
      existing.stock = service.stock ?? existing.stock;
    }
  }

  const numberPlans = plans.filter((plan) => plan.service === "numbers");

  const plansOut = numberPlans.map((plan) => {
    const intent = fulfilmentIntent(plan.slug);
    const country = intent?.kind === "sms" ? intent.country : null;
    const supplier = country ? byCountry.get(country.toLowerCase()) : null;
    const fulfillable = isPlanFulfillable(plan.slug) && !!country;

    return {
      id: `live-number-${plan.slug}`,
      service: "numbers",
      slug: plan.slug,
      name: plan.name,
      planLabel: plan.planLabel,
      region: plan.region,
      flag: plan.flag,
      duration: plan.duration,
      price: plan.price,
      features: plan.features,
      country,
      supplierCostNgn: supplier?.priceNgn ?? null,
      stock: supplier?.stock ?? null,
      fulfillable,
      action: fulfillable
        ? { label: "Buy number", href: `/dashboard/services/numbers/${plan.slug}` }
        : null,
    };
  });

  return NextResponse.json(
    { ok: true, plans: plansOut },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
