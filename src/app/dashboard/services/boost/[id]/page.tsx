import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { findBoostListing } from "@/lib/smm-catalog";
import { isSmmPanelConfigured } from "@/lib/smm-panel";
import { formatNaira } from "@/lib/catalog";
import { BrandIcon } from "@/components/BrandIcon";
import { BoostPurchaseForm } from "./BoostPurchaseForm";

export const metadata: Metadata = { title: "Buy a boost" };
export const dynamic = "force-dynamic";

/**
 * One boosting service, with a link and a quantity.
 *
 * There is no country step: a boost targets a profile or a post, not a market.
 * The page is read-only when the supplier is not configured, when the listing
 * no longer exists, or when it has no retail price — a Buy button that cannot
 * charge the right amount is worse than none.
 */
export default async function BoostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser("/dashboard/services");

  if (!isSmmPanelConfigured()) notFound();

  const found = await findBoostListing(id).catch(() => null);
  if (!found) notFound();
  const { listing } = found;

  const perThousand = listing.perThousand;
  const min = listing.min;
  const priceFrom =
    perThousand !== null && min !== null ? Math.ceil((perThousand * min) / 1_000) : null;

  return (
    <div className="grid gap-5">
      <Link href="/dashboard/services?category=social" className="w-fit text-meta font-semibold text-lav-700 hover:underline">
        ← Back to social promotion
      </Link>

      <div>
        <p className="text-meta font-semibold uppercase tracking-[0.14em] text-lav-700">Social promotion</p>
        <h1 className="mt-2 flex items-center gap-2.5 text-[1.6rem] font-semibold text-ink">
          {listing.artwork.kind === "brand" && (
            <BrandIcon brand={listing.artwork.name} size={28} variant="tile" decorative />
          )}
          {listing.name}
        </h1>
        <p className="mt-1 text-[0.84rem] text-ink-2">
          {listing.tag}
          {priceFrom !== null && <> · from {formatNaira(priceFrom)}</>}
          {listing.min !== null && listing.max !== null && (
            <> · between {listing.min.toLocaleString("en-NG")} and {listing.max.toLocaleString("en-NG")} units</>
          )}
        </p>
      </div>

      {priceFrom === null || perThousand === null || min === null ? (
        <div role="note" className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4 text-meta leading-relaxed text-amber-900">
          <p className="font-semibold">This boosting service is not for sale right now.</p>
          <p className="mt-1">
            It is listed for comparison only. Nothing can be charged for it, and no order can be placed.
          </p>
        </div>
      ) : (
        <BoostPurchaseForm
          listing={{
            id: listing.id,
            name: listing.name,
            tag: listing.tag,
            perThousand,
            min,
            max: listing.max,
          }}
          walletBalance={user.walletBalance}
        />
      )}

      <div role="note" className="rounded-2xl border border-line bg-white p-4 text-meta leading-relaxed text-ink-2">
        <p className="font-semibold text-ink">How a boost is delivered</p>
        <p className="mt-1">
          Delivery starts after your order is placed. Your link must be public while it runs, and the platform&apos;s own
          rules still apply to your account — buying engagement does not protect it from a platform decision.
        </p>
        <p className="mt-1">
          Wallet balance: <strong className="text-ink">{formatNaira(user.walletBalance)}</strong> ·{" "}
          <Link href="/dashboard/wallet" className="font-semibold text-lav-700 hover:underline">Top up</Link>
        </p>
      </div>
    </div>
  );
}
