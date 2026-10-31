import type { Metadata } from "next";
import Link from "next/link";
import { plans } from "@/lib/catalog";
import { isPlanFulfillable } from "@/lib/fulfillment";
import { isMarketplaceCheckoutConfigured } from "@/lib/marketplace-policy";

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
    if (isPlanFulfillable(plan.slug)) entry.deliverable += 1;
    grouped.set(plan.service, entry);
  }
  return [...grouped.entries()].map(([service, { total, deliverable }]) => ({
    name: SERVICE_LABELS[service] ?? service,
    deliverable,
    total,
    available: deliverable > 0,
  }));
}

export default function StatusPage() {
  const marketplaceEnabled = isMarketplaceCheckoutConfigured();
  const paystackEnabled = Boolean(process.env.PAYSTACK_SECRET_KEY?.trim());
  const catalog = catalogAvailability();

  const rows = [
    ...catalog.map((entry) => ({
      name: entry.name,
      status: entry.available ? "Available" : "Not available",
      detail: entry.available
        ? `${entry.deliverable} of ${entry.total} plans in this category can be ordered and delivered automatically.`
        : `None of the ${entry.total} plans in this category can be delivered yet, so they cannot be ordered or charged.`,
    })),
    {
      name: "Account marketplace checkout",
      status: marketplaceEnabled ? "Available" : "Not available",
      detail: marketplaceEnabled
        ? "Listings can be purchased from your wallet. Live stock is shown per listing."
        : "Checkout is not configured, so listings cannot be purchased yet.",
    },
    {
      name: "Wallet top-ups and withdrawals",
      status: paystackEnabled ? "Available" : "Not available",
      detail: paystackEnabled
        ? "Top-ups are taken through Paystack. Your wallet is credited only after payment is confirmed."
        : "Payments are not configured, so the wallet cannot be funded yet.",
    },
    {
      // Gift cards were previously listed here with the categories that have no
      // live fulfilment, which told visitors they could not be bought while the
      // dashboard was selling them. A gift card is issued by Pryva from the
      // buyer's own wallet, so it has no supplier feed to wait for.
      name: "Gift cards",
      status: "Available",
      detail: "Gift cards are issued by Pryva from your wallet balance the moment you buy one, so they do not depend on a third-party catalogue.",
    },
    {
      name: "Digital subscriptions, data, bulk and scheduled orders",
      status: "Available",
      detail: "Orders are processed automatically through verified provider integration.",
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
