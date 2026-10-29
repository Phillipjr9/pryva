import type { Metadata } from "next";
import Link from "next/link";
import { AccountsBrowser } from "./AccountsBrowser";
import { isMarketplaceCheckoutConfigured } from "@/lib/marketplace-policy";
import { PlatformStrip } from "@/components/PlatformBadge";

export const metadata: Metadata = {
  title: "Digital Account Listings — Facebook, Instagram, Gmail & More | Pryva",
  description:
    "Browse digital account listings priced in Naira. Purchase availability and delivery depend on current stock.",
  alternates: { canonical: "/accounts" },
  openGraph: {
    title: "Digital Account Listings | Pryva",
    description:
      "Browse Facebook, Instagram, Gmail, TikTok and more, with Naira pricing.",
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
              Browse digital account listings priced in Naira.
            </h1>
            <p className="mt-4 max-w-2xl text-[1rem] leading-relaxed text-ink-2">
              Facebook, Instagram, Gmail, Outlook, TikTok, gaming and streaming accounts — browse
              listings priced in Naira. Uncertain purchases require review by support.
            </p>
            <PlatformStrip
              className="mt-6"
              size={30}
              platforms={[
                "facebook",
                "instagram",
                "gmail",
                "outlook",
                "tiktok",
                "x",
                "telegram",
                "discord",
                "netflix",
                "spotify",
              ]}
            />

            <div className="mt-6 flex flex-wrap items-center gap-3 text-[0.82rem] text-ink-3">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-lav-600" /> Digital listings
              </span>
              <span aria-hidden>·</span>
              <span>Live stock counts</span>
              <span aria-hidden>·</span>
              <span>Support reviews uncertain orders</span>
              <span aria-hidden>·</span>
              <span>Wallet payment only</span>
            </div>
          </div>
        </div>
      </section>

      <section className="shell py-10 sm:py-12">
        <AccountsBrowser purchaseEnabled={isMarketplaceCheckoutConfigured()} />
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
              body: "When delivery is confirmed, credentials are shown on your order.",
            },
            {
              title: "Support for uncertain orders",
              body: "If delivery cannot be confirmed, support will review the order before any refund.",
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
            Accounts are delivered exactly as described and are not screened by Pryva beyond the
            checks described here. Use them in line with each platform&apos;s terms — some platforms restrict
            account transfers, and you accept that risk when you buy. Save your credentials on delivery;
            if we cannot save them to your order history, we will warn you. See our{" "}
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
