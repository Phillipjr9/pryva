import { paystackKeyUsable } from "@/lib/paystack-policy";
import { financialActionsUnavailable } from "@/lib/financial-environment";
import type { Metadata } from "next";
import Link from "next/link";
import { plans } from "@/lib/catalog";
import { isNumberPlanOrderingConfigured } from "@/lib/number-availability";
import { isMarketplaceCheckoutConfigured } from "@/lib/marketplace-policy";
import { esimCategoryOrderable } from "@/lib/esim-availability";

export const metadata: Metadata = {
  title: "Service Status",
  description: "Current feature availability and service monitoring information.",
};
export const dynamic = "force-dynamic";

/**
 * Availability is derived from the fulfilment allowlist rather than written by
 * hand. A status page that disagrees with what checkout will actually do is
 * worse than no status page, so each row is computed from the same map that
 * decides whether an order can be placed at all.
 */
const SERVICE_LABELS: Record<string, string> = {
  numbers: "Virtual numbers (SMS verification & rentals)",
  esim: "eSIM data plans",
  proxies: "Residential proxies",
  "email-otp": "Temporary email inboxes",
};

function catalogAvailability() {
  const grouped = new Map<string, { total: number; deliverable: number }>();
  for (const plan of plans) {
    const entry = grouped.get(plan.service) ?? { total: 0, deliverable: 0 };
    entry.total += 1;
    if (isNumberPlanOrderingConfigured(plan.slug)) entry.deliverable += 1;
    grouped.set(plan.service, entry);
  }
  return [...grouped.entries()].map(([service, { total, deliverable }]) => ({
    service,
    name: SERVICE_LABELS[service] ?? service,
    deliverable,
    total,
    available: deliverable > 0,
  }));
}

export default function StatusPage() {
  const marketplaceEnabled = isMarketplaceCheckoutConfigured();
  const paystackEnabled = !financialActionsUnavailable() && paystackKeyUsable(process.env.PAYSTACK_SECRET_KEY);
  const catalog = catalogAvailability();
  const availableNumbers = catalog.some((entry) => entry.service === "numbers" && entry.available);
  const giftCardsAvailable = !financialActionsUnavailable();

  const rows = [
    ...catalog.map((entry) => ({
      name: entry.name,
      status: entry.available ? "Available" : "Not available",
      detail: entry.available
        ? `${entry.deliverable} of ${entry.total} plans have a configured ordering path. Confirm current stock and terms before buying.`
        : `No ordering path is currently configured for the ${entry.total} plans in this category, so they cannot be ordered or charged.`,
    })),
    {
      name: SERVICE_LABELS.esim,
      status: esimCategoryOrderable() ? "Ordering configured" : "Not available",
      detail: esimCategoryOrderable()
        ? "eSIM ordering is configured. Live plans and coverage are not verified here; check your dashboard."
        : "eSIM ordering is unavailable here. Coverage and prices are not currently available.",
    },
    {
      name: "Account marketplace checkout",
      status: marketplaceEnabled ? "Available" : "Not available",
      detail: marketplaceEnabled
        ? "Listings can be purchased from your wallet. Live stock is shown per listing."
        : "Checkout is unavailable here, so listings cannot be purchased yet.",
    },
    {
      name: "Wallet top-ups and withdrawals",
      status: paystackEnabled ? "Available" : "Not available",
      detail: paystackEnabled
        ? "Top-ups are taken through Paystack. Your wallet is credited only after payment is confirmed."
        : "Payments are unavailable here, so the wallet cannot be funded yet.",
    },
    {
      name: "Gift cards",
      status: giftCardsAvailable ? "Available" : "Not available",
      detail: giftCardsAvailable
        ? "Gift cards are issued by Pryva from your wallet balance. Review the amount before confirming."
        : "Gift-card purchases and redemption are unavailable in this environment.",
    },
    {
      name: "Digital subscriptions and mobile data",
      status: "Not available",
      detail: "Ordering is not connected for these categories, so no wallet charge can be made.",
    },
    {
      name: "Bulk and scheduled number orders",
      status: availableNumbers ? "Ordering configured" : "Not available",
      detail: availableNumbers
        ? "Eligible number plans can be ordered in bulk or scheduled. Schedules are checked nightly."
        : "These tools need an available number ordering path before they can place an order.",
    },
    {
      name: "Automatic refunds",
      status: "Reviewed by support",
      detail: "Refunds are assessed against the delivery outcome. Contact support with your order reference.",
    },
  ];

  return (
    <div className="min-h-screen bg-cream py-16">
      <div className="shell max-w-3xl">
        <h1 className="text-4xl font-medium tracking-tight text-ink">Service status</h1>
        <div className="mt-7 rounded-2xl border border-amber-200 bg-amber-50 p-6">
          <h2 className="text-lg font-semibold text-amber-950">Live monitoring is not connected</h2>
          <p className="mt-2 text-sm leading-6 text-amber-900">
            This page reports which products can be ordered and delivered. It does not verify
            delivery-partner uptime or current incidents, so it is not a live health check.
          </p>
        </div>
        <div className="mt-8 space-y-4">
          {rows.map((service) => (
            <section key={service.name} className="rounded-2xl border border-line bg-white p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <h2 className="font-semibold text-ink">{service.name}</h2>
                <span
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${
                    service.status === "Available"
                      ? "bg-emerald-50 text-emerald-700"
                      : service.status === "Not available"
                        ? "bg-amber-50 text-amber-800"
                        : "bg-lav-100 text-lav-700"
                  }`}
                >
                  {service.status}
                </span>
              </div>
              <p className="mt-2 text-sm leading-6 text-ink-2">{service.detail}</p>
            </section>
          ))}
        </div>
        <p className="mt-8 text-sm text-ink-2">
          For an existing order or wallet issue,{" "}
          <Link href="/contact" className="font-semibold text-lav-700">contact support</Link> with
          your reference.
        </p>
      </div>
    </div>
  );
}
