import type { Metadata } from "next";
import Link from "next/link";
import { AccountsBrowser } from "./AccountsBrowser";

export const metadata: Metadata = {
  title: "Verified Digital Accounts — Facebook, Instagram, Gmail & More | Pryva",
  description:
    "Buy verified digital accounts in Naira. Facebook, Instagram, Gmail, TikTok, gaming and streaming accounts delivered instantly from your Pryva wallet, with automatic refunds if delivery fails.",
  alternates: { canonical: "/accounts" },
  openGraph: {
    title: "Verified Digital Accounts | Pryva",
    description:
      "Facebook, Instagram, Gmail, TikTok and more — instant delivery, Naira pricing, automatic refunds.",
    url: "/accounts",
    type: "website",
  },
};

export default function AccountsPage() {
  return (
    <main>
      <section className="border-b border-line/70 bg-gradient-to-b from-cream to-white">
        <div className="shell py-14 sm:py-20">
          <div className="max-w-3xl">
            <span className="inline-flex items-center gap-2 rounded-full border border-lav-200 bg-white px-3 py-1 text-[0.72rem] font-semibold uppercase tracking-[0.16em] text-lav-800">
              Digital accounts
            </span>
            <h1 className="mt-5 text-[2.1rem] font-semibold leading-[1.1] tracking-tight text-ink sm:text-[2.9rem]">
              Every verified account you need, priced in Naira.
            </h1>
            <p className="mt-4 max-w-2xl text-[1rem] leading-relaxed text-ink-2">
              Facebook, Instagram, Gmail, Outlook, TikTok, gaming and streaming accounts — browse live
              stock, buy from your wallet, and receive the credentials instantly. If delivery fails, the
              amount returns to your wallet automatically.
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-3 text-[0.82rem] text-ink-3">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Instant delivery
              </span>
              <span aria-hidden>·</span>
              <span>Live stock counts</span>
              <span aria-hidden>·</span>
              <span>Automatic refund on failure</span>
              <span aria-hidden>·</span>
              <span>Wallet payment only</span>
            </div>
          </div>
        </div>
      </section>

      <section className="shell py-10 sm:py-12">
        <AccountsBrowser />
      </section>

      <section className="border-t border-line/70 bg-cream/60">
        <div className="shell grid gap-6 py-12 sm:grid-cols-3">
          {[
            {
              title: "Buy only what you need",
              body: "Single accounts or bundles of up to 50. Larger baskets automatically receive a volume discount.",
            },
            {
              title: "Credentials on the spot",
              body: "Your accounts appear the moment payment clears — copy them straight into your workflow.",
            },
            {
              title: "Not delivered, not charged",
              body: "If an order can't be fulfilled, the full amount is refunded to your wallet automatically.",
            },
          ].map((item) => (
            <div key={item.title} className="rounded-2xl border border-line bg-white p-5">
              <h2 className="text-[0.95rem] font-semibold text-ink">{item.title}</h2>
              <p className="mt-2 text-[0.85rem] leading-relaxed text-ink-2">{item.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="shell py-12">
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6">
          <h2 className="text-[0.95rem] font-semibold text-amber-900">Before you buy</h2>
          <p className="mt-2 max-w-3xl text-[0.85rem] leading-relaxed text-amber-900/80">
            Accounts are delivered exactly as supplied and are not screened by Pryva beyond what the
            seller states. Use them in line with each platform&apos;s terms — some platforms restrict
            account transfers, and you accept that risk when you buy. Credentials are shown once on
            delivery and are also available in your order history. See our{" "}
            <Link href="/terms" className="font-semibold underline underline-offset-2">
              Terms
            </Link>{" "}
            for refund details.
          </p>
        </div>
      </section>
    </main>
  );
}
