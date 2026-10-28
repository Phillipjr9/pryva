import type { Metadata } from "next";
import Link from "next/link";
import { isMarketplaceCheckoutConfigured } from "@/lib/marketplace-policy";
import { isPreviewDatabase } from "@/lib/demo-policy";

export const metadata: Metadata = {
  title: "Service Status",
  description: "Current feature availability and service monitoring information.",
};
export const dynamic = "force-dynamic";

export default function StatusPage() {
  const preview = isPreviewDatabase();
  const marketplaceEnabled = isMarketplaceCheckoutConfigured();

  return (
    <div className="min-h-screen bg-cream py-16">
      <div className="shell max-w-3xl">
        <h1 className="text-4xl font-medium tracking-tight text-ink">Service status</h1>
        <div className="mt-7 rounded-2xl border border-amber-200 bg-amber-50 p-6">
          <h2 className="text-lg font-semibold text-amber-950">Live monitoring is not connected</h2>
          <p className="mt-2 text-sm leading-6 text-amber-900">
            This page cannot verify provider availability, uptime, or current incidents. The feature settings below are not a live health check.
          </p>
        </div>
        <div className="mt-8 space-y-4">
          {[
            {
              name: "Numbers, eSIM, proxies, email, data, bulk and scheduled fulfillment",
              status: preview ? "Preview only" : "Live fulfillment paused",
              detail: preview ? "Preview orders are simulated and do not provide live products." : "Live fulfillment is not currently enabled.",
            },
            {
              name: "Account marketplace checkout",
              status: marketplaceEnabled ? "Enabled; provider health unknown" : "Paused",
              detail: marketplaceEnabled ? "Checkout is configured, but this page does not monitor live fulfillment." : "Live checkout is unavailable in this environment.",
            },
            {
              name: "Wallet, payments and bank transfers",
              status: preview ? "Preview only" : "Not monitored",
              detail: preview ? "Balances are simulated and bank transfers are unavailable." : "Payment-provider and transfer availability are not monitored here.",
            },
            {
              name: "Automatic live-order refunds",
              status: "Paused",
              detail: "Live orders require provider reconciliation and manual review.",
            },
          ].map((service) => (
            <section key={service.name} className="rounded-2xl border border-line bg-white p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <h2 className="font-semibold text-ink">{service.name}</h2>
                <span className="rounded-full bg-lav-100 px-3 py-1 text-xs font-semibold text-lav-700">{service.status}</span>
              </div>
              <p className="mt-2 text-sm leading-6 text-ink-2">{service.detail}</p>
            </section>
          ))}
        </div>
        <p className="mt-8 text-sm text-ink-2">
          For an existing order or wallet issue, <Link href="/contact" className="font-semibold text-lav-700">contact support</Link> with your reference.
        </p>
      </div>
    </div>
  );
}
