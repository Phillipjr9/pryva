import { NextRequest } from "next/server";
import { authorizeAdminApi } from "@/lib/admin-auth";
import { bitcallKeyEnvironment, isBitcallConfigured } from "@/lib/bitcall";
import { getUsdToNgnRate } from "@/lib/exchange-rate";
import { fulfilablePlans } from "@/lib/fulfillment";
import { otpSupplierConfigured, otpSupplierOrder, otpSupplierProbe } from "@/lib/otp-suppliers";

export const dynamic = "force-dynamic";

/**
 * What the number suppliers can actually do right now, for the operator.
 *
 * A fallback supplier is only real if it is configured *and* answering, and both
 * of those fail silently at purchase time: a bad key just means the catalogue
 * comes back empty and the purchase quietly proceeds with the other supplier.
 * Silent is the right behaviour for a customer and the wrong one for whoever set
 * the key, so this endpoint answers the question directly.
 *
 * It is strictly read-only. Nothing here buys, cancels or reactivates: a
 * diagnostic that can spend money is a diagnostic nobody dares call in
 * production. Only error *codes* are reported — never an upstream message (which
 * can carry a response body) and never any part of a credential.
 */
export async function GET(request: NextRequest) {
  const access = await authorizeAdminApi(request);
  if (access.response) return access.response;

  const requested = new URL(request.url).searchParams.get("country")?.trim().toLowerCase() || null;

  // Derived from the fulfilment allowlist rather than typed out again, so this
  // can never report on a destination the storefront cannot sell.
  const destinations = new Map<string, string>();
  for (const { plan, intent } of fulfilablePlans()) {
    if (intent.kind !== "sms") continue;
    if (!destinations.has(intent.country)) destinations.set(intent.country, plan.region);
  }

  const wanted = [...destinations.entries()].filter(([code]) => !requested || code === requested);
  const order = otpSupplierOrder();
  const configured = Object.fromEntries(order.map((supplier) => [supplier, otpSupplierConfigured(supplier)]));

  const rate = Object.values(configured).some(Boolean) ? await getUsdToNgnRate() : null;

  const reports = await Promise.all(
    wanted.map(async ([code, name]) => {
      const suppliers = await Promise.all(
        order.map(async (supplier) => {
          const probe = await otpSupplierProbe(supplier, code, name);
          const priced = probe.offers.filter((offer) => offer.costNgn !== null);
          const inStock = priced.filter((offer) => offer.stock === null || offer.stock > 0);
          return {
            supplier,
            configured: configured[supplier],
            listed: probe.offers.length,
            priced: priced.length,
            inStock: inStock.length,
            cheapestNgn: inStock.length > 0
              ? Math.min(...inStock.map((offer) => offer.costNgn as number))
              : null,
            apps: [...new Set(inStock.map((offer) => offer.app).filter((app): app is string => Boolean(app)))].slice(0, 10),
            errorCode: probe.errorCode,
          };
        }),
      );

      return {
        country: code,
        name,
        // The supplier a purchase would try first, and whether it can sell at
        // all: that pair is the only thing standing between a customer and a
        // refund, so it is the headline rather than a field to hunt for.
        sellable: suppliers.some((entry) => entry.inStock > 0),
        suppliers,
      };
    }),
  );

  return Response.json(
    {
      ok: true,
      routing: { order, configured },
      // Which environment the credential is for. A test key in production is
      // otherwise invisible until someone compares prices or balances.
      gateway: { keyEnvironment: bitcallKeyEnvironment() },
      esim: { orderable: isBitcallConfigured() },
      // The rate every dollar price is converted at; null when nothing is
      // configured, because nothing would be converted.
      usdToNgn: rate ? { rate: rate.rate, source: rate.source } : null,
      destinations: reports,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
