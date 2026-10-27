import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Refund Policy",
  description:
    "How and when Pryva refunds your wallet — automatic refunds for undelivered numbers, data and accounts, and the products that are non-refundable.",
  alternates: { canonical: "/refund-policy" },
};

const rows = [
  {
    product: "Virtual numbers & rental numbers",
    refund: "Automatic",
    detail:
      "If no verification code arrives within the service window, the full amount is returned to your wallet. You don't need to contact us.",
  },
  {
    product: "Email OTP inboxes",
    refund: "Automatic",
    detail: "Refunded in full if the inbox can't be provisioned or no code is delivered in time.",
  },
  {
    product: "eSIM data & residential proxies",
    refund: "Case by case",
    detail:
      "Refunded if the activation details are never delivered. Once an eSIM is activated or a proxy pack is used, the data has been consumed and can't be refunded.",
  },
  {
    product: "Digital accounts (marketplace)",
    refund: "Automatic",
    detail:
      "If the seller can't deliver, the full amount returns to your wallet immediately. Credentials already delivered are not refundable — they've been handed over and can't be recalled.",
  },
  {
    product: "Airtime & data bundles",
    refund: "Failed delivery only",
    detail:
      "Refunded if the network rejects the transfer. Delivered airtime and data can't be reversed, so the number is shown for confirmation before you pay.",
  },
  {
    product: "Gift cards",
    refund: "Not refundable",
    detail:
      "Gift cards are strictly non-refundable, whether redeemed or not. This is enforced in the backend, not just the wording on this page.",
  },
  {
    product: "Bulk & scheduled orders",
    refund: "All or nothing",
    detail:
      "A bulk basket is charged once and refunded in full if any part fails. Scheduled orders can be paused or cancelled before their next run.",
  },
];

export default function RefundPolicyPage() {
  return (
    <main>
      <section className="border-b border-line/70 bg-gradient-to-b from-cream to-white">
        <div className="shell py-14 sm:py-16">
          <h1 className="text-[2.2rem] font-semibold tracking-tight text-ink sm:text-[2.6rem]">
            Refund Policy
          </h1>
          <p className="mt-3 max-w-2xl text-[0.98rem] leading-relaxed text-ink-2">
            Most refunds happen without you asking. When a product doesn&apos;t arrive, the amount
            goes back to your wallet automatically — you keep the reference, we keep the receipts.
          </p>
          <p className="mt-4 text-[0.82rem] text-ink-3">
            Last updated: {new Date().toLocaleDateString("en-NG", { year: "numeric", month: "long", day: "numeric" })}
          </p>
        </div>
      </section>

      <section className="shell py-10">
        <div className="overflow-hidden rounded-2xl border border-line bg-white">
          <table className="w-full text-left">
            <thead className="bg-cream/70 text-[0.72rem] uppercase tracking-[0.12em] text-ink-3">
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
                      className={`inline-flex rounded-full px-2.5 py-1 text-[0.7rem] font-semibold ${
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
              Wallet refunds are instant — the moment a fulfilment attempt fails it&apos;s credited back
              and appears in your transaction history. If you paid with a card and want the money off
              Pryva entirely, contact support; bank reversals take 5–10 business days depending on your
              bank.
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
            . We check the fulfilment logs and answer within one business day. Please don&apos;t raise a
            chargeback before talking to us — it takes longer and freezes your wallet in the meantime.
          </p>
        </div>
      </section>
    </main>
  );
}
