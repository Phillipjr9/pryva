import { bitcallKeyEnvironment, getBitcallBalance, isBitcallConfigured } from "@/lib/providers/bitcall";
import { getUsdToNgnRate } from "@/lib/payments/exchange-rate";
import { supplierAmountToNgn } from "@/lib/payments/supplier-currency";
import { fulfilablePlans } from "@/lib/services/fulfillment";
import { checkMargin } from "@/lib/services/margin-guard";
import { otpSupplierConfigured, otpSupplierOrder, otpSupplierProbe } from "@/lib/services/numbers/otp-suppliers";

export type SupplierHealthDestination = {
  country: string;
  name: string;
  sellable: boolean;
  suppliers: Array<{
    supplier: string;
    configured: boolean;
    listed: number;
    priced: number;
    inStock: number;
    cheapestNgn: number | null;
    apps: string[];
    errorCode: string | null;
  }>;
};

export type SupplierHealthPlan = {
  slug: string;
  name: string;
  country: string;
  ourPriceNgn: number;
  cheapest: { supplier: string; costNgn: number | null } | null;
  profitNgn: number | null;
  marginPct: number | null;
  clearsFloor: boolean;
  blockedBy: string | null;
};

export type SupplierHealthReport = {
  routing: { order: string[]; configured: Record<string, boolean> };
  gateway: {
    keyEnvironment: string | null;
    balance: { amount: number | null; currency: string | null; amountNgn: number | null } | null;
  };
  usdToNgn: { rate: number; source: string } | null;
  plans: SupplierHealthPlan[];
  destinations: SupplierHealthDestination[];
  esim?: { orderable: boolean };
};

export async function readSupplierHealth(options: { country?: string | null } = {}): Promise<SupplierHealthReport> {
  const requested = options.country?.trim().toLowerCase() || null;

  const destinations = new Map<string, string>();
  for (const { plan, intent } of fulfilablePlans()) {
    if (intent.kind !== "sms") continue;
    if (!destinations.has(intent.country)) destinations.set(intent.country, plan.region);
  }

  const wanted = [...destinations.entries()].filter(([code]) => !requested || code === requested);
  const order = otpSupplierOrder();
  const configured = Object.fromEntries(order.map((supplier) => [supplier, otpSupplierConfigured(supplier)]));

  const rate = Object.values(configured).some(Boolean) ? await getUsdToNgnRate() : null;

  const balance = await (async () => {
    if (!isBitcallConfigured()) return null;
    try {
      const { balance: amount, currency } = await getBitcallBalance();
      return { amount, currency, amountNgn: await supplierAmountToNgn(amount, currency) };
    } catch {
      return { amount: null, currency: null, amountNgn: null };
    }
  })();

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
            cheapestNgn:
              inStock.length > 0 ? Math.min(...inStock.map((offer) => offer.costNgn as number)) : null,
            apps: [...new Set(inStock.map((offer) => offer.app).filter((app): app is string => Boolean(app)))].slice(0, 10),
            errorCode: probe.errorCode,
          };
        }),
      );

      return {
        country: code,
        name,
        sellable: suppliers.some((entry) => entry.inStock > 0),
        suppliers,
      };
    }),
  );

  const byCountry = new Map(reports.map((report) => [report.country, report]));
  const plans = fulfilablePlans()
    .filter(({ intent }) => intent.kind === "sms")
    .map(({ plan, intent }) => {
      const country = intent.kind === "sms" ? intent.country : "";
      const offers = byCountry.get(country)?.suppliers ?? [];
      const cheapest = offers
        .filter((entry) => entry.cheapestNgn !== null)
        .sort((a, b) => (a.cheapestNgn as number) - (b.cheapestNgn as number))[0] ?? null;
      const margin = cheapest ? checkMargin(plan.price, cheapest.cheapestNgn) : null;

      return {
        slug: plan.slug,
        name: plan.name,
        country,
        ourPriceNgn: plan.price,
        cheapest: cheapest ? { supplier: cheapest.supplier, costNgn: cheapest.cheapestNgn } : null,
        profitNgn: margin?.marginNgn ?? null,
        marginPct: margin?.ok ? Math.round(margin.marginRatio * 1000) / 10 : null,
        clearsFloor: margin?.ok ?? false,
        blockedBy: margin && !margin.ok ? margin.code : null,
      };
    });

  return {
    routing: { order, configured },
    gateway: { keyEnvironment: bitcallKeyEnvironment(), balance },
    usdToNgn: rate ? { rate: rate.rate, source: rate.source } : null,
    plans,
    destinations: reports,
  };
}
