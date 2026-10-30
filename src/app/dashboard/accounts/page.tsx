import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { AccountsBrowser } from "@/app/(site)/accounts/AccountsBrowser";
import { ArrowRight, Shield } from "@/components/icons";
import { isMarketplaceCheckoutConfigured } from "@/lib/marketplace-policy";
import { ServiceTitle } from "@/components/ServiceTitle";

export const metadata: Metadata = { title: "Accounts" };

/**
 * The accounts catalogue, inside the dashboard shell.
 *
 * This used to be a link straight to the marketing page, so clicking it dropped
 * the sidebar, the wallet balance and the bottom tabs. The browser component is
 * reused as-is (it already talks to /api/accounts/*), and the marketing-only
 * sections — hero, trust strip — are left behind.
 */
export default async function DashboardAccountsPage() {
  const user = await requireUser("/dashboard/accounts");

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <ServiceTitle service="accounts">
            Digital accounts
          </ServiceTitle>
          <p className="mt-1 text-[0.86rem] text-ink-2">
            Browse live listings priced in Naira. Country coverage is not provided or filtered here, and stock can change.
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white/70 px-2.5 py-1 text-micro text-ink-3">
          <Shield className="h-3 w-3 text-lav-600" /> Support reviews delivery issues
        </span>
      </div>

      <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50/70 px-3.5 py-2.5 text-meta leading-relaxed text-amber-900">
        <Shield className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Accounts are delivered exactly as described. Some platforms restrict account transfers — you
        accept that risk when you buy.
        <Link href="/terms" className="ml-1 shrink-0 font-semibold underline underline-offset-2">
          Terms
        </Link>
      </p>

      <AccountsBrowser purchaseEnabled={isMarketplaceCheckoutConfigured()} />

      <p className="text-meta text-ink-3">
        Wallet balance: <strong className="text-ink">{user.walletBalance.toLocaleString("en-NG", { style: "currency", currency: "NGN", minimumFractionDigits: 0 })}</strong>{" "}
        ·{" "}
        <Link href="/dashboard/wallet" className="inline-flex items-center gap-1 font-semibold text-lav-700 hover:underline">
          Top up <ArrowRight className="h-3 w-3" />
        </Link>
      </p>
    </div>
  );
}
