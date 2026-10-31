import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Refund Policy",
  description:
    "How Pryva reviews delivery issues and refund requests.",
  alternates: { canonical: "/refund-policy" },
};

const rows = [
  {
    product: "Virtual numbers & rental numbers",
    refund: "Review required",
    detail:
      "Refunds are reviewed against the delivery outcome. If the window closed and no code arrived, contact support with your order reference.",
  },
  {
    product: "Email OTP inboxes",
    refund: "Review required",
    detail: "Email OTP inboxes are not available for purchase yet, so no charge can be raised for one.",
  },
  {
    product: "eSIM data & residential proxies",
    refund: "Case by case",
    detail:
      "Contact support to review delivery and provider status. Issued or consumed goods are not automatically refundable.",
  },
  {
    product: "Digital accounts (marketplace)",
    refund: "Review required",
    detail:
      "Uncertain purchases are held for provider reconciliation. Contact support with your reference and do not place the same order again.",
  },
  {
    product: "Airtime & data bundles",
    refund: "Failed delivery only",
    detail:
      "Failed deliveries are refunded automatically to your wallet balance.",
  },
  {
    product: "Gift cards",
    refund: "Not refundable",
    detail:
      "Gift cards are strictly non-refundable, whether redeemed or not. This is enforced in the backend, not just the wording on this page.",
  },
  {
    product: "Bulk & scheduled orders",
    refund: "Failed units refunded",
    detail:
      "Failed or unfulfilled units are refunded to your wallet.",
  },
];

export default function RefundPolicyPage() {
  return (
    <div>
      <section className="border-b border-line/70 bg-gradient-to-b from-cream to-white">
        <div className="shell py-14 sm:py-16">
          <h1 className="text-[2.2rem] font-semibold tracking-tight text-ink sm:text-[2.6rem]">
            Refund Policy
          </h1>
          <p className="mt-3 max-w-2xl text-[0.98rem] leading-relaxed text-ink-2">
            Automatic refunds are processed for failed or cancelled deliveries.
            Contact support with your order reference if you need assistance.
          </p>
        </div>
      </section>

      <section className="shell py-10">
        <div className="overflow-x-auto rounded-2xl border border-line bg-white">
          <table className="w-full min-w-[32rem] text-left">
            <thead className="bg-cream/70 text-meta uppercase tracking-[0.12em] text-ink-3">
              <tr>
                <th className="px-4 py-3 font-semibold">Product</th>
                <th className="px-4 py-3 font-semibold">Refund</th>
                <th className="hidden px-4 py-3 font-semibold md:table-cell">How it works</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/70">
              {rows.map((row) => (
                <tr key={row.product} className="align-top">
                  <td className="px-4 py-4 text-[0.88rem] font-medium text-ink">{row.product}</td>
                  <td className="px-4 py-4">
                    <span
                      className={`inline-flex rounded-full px-2.5 py-1 text-meta font-semibold ${
                        row.refund === "Not refundable"
                          ? "bg-red-50 text-red-700"
                          : row.refund === "Automatic"
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-lav-50 text-lav-700"
                      }`}
                    >
                      {row.refund}
                    </span>
                  </td>
                  <td className="px-4 py-4 text-[0.84rem] leading-relaxed text-ink-2 md:table-cell">
                    {row.detail}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-line bg-white p-5">
            <h2 className="text-[0.95rem] font-semibold text-ink">How fast are refunds?</h2>
            <p className="mt-2 text-[0.85rem] leading-relaxed text-ink-2">
              A refund is recorded in your wallet after it has been approved and processed. Timing
              depends on the provider review. Contact support if you need help with a payment.
            </p>
          </div>
          <div className="rounded-2xl border border-line bg-white p-5">
            <h2 className="text-[0.95rem] font-semibold text-ink">What isn&apos;t covered</h2>
            <p className="mt-2 text-[0.85rem] leading-relaxed text-ink-2">
              Products that were delivered and then misused, accounts banned by the platform they belong
              to, and gift cards. We can&apos;t reverse a delivered credential or a consumed data bundle.
            </p>
          </div>
        </div>

        <div className="mt-8 rounded-2xl border border-amber-200 bg-amber-50 p-5">
          <h2 className="text-[0.95rem] font-semibold text-amber-900">Disputes</h2>
          <p className="mt-2 max-w-3xl text-[0.85rem] leading-relaxed text-amber-900/80">
            If you believe a charge was wrong, message us with your order reference within 14 days via{" "}
            <Link href="/contact" className="font-semibold underline underline-offset-2">
              support
            </Link>
            . We will review the available delivery and payment records.
          </p>
        </div>
      </section>
    </div>
  );
}
