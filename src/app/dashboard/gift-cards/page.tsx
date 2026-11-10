import { GiftCardsManager } from "./GiftCardsManager";
import { requireUser } from "@/lib/identity/auth";
import { legacyBrandGiftCardSalesEnabled } from "@/lib/services/gift-cards/brand-readiness";
import { ServiceTitle } from "@/components/ServiceTitle";

export const dynamic = "force-dynamic";

export default async function GiftCardsPage() {
  const user = await requireUser("/dashboard/gift-cards");

  return (
    <div className="space-y-6">
      <div>
        <ServiceTitle service="gift-cards">Gift Cards</ServiceTitle>
        <p className="mt-1 text-[0.875rem] text-ink-2">
          Explore brand gift cards or send Pryva wallet credit. Brand gift card availability is shown below.
        </p>
      </div>
      <GiftCardsManager user={user} brandSalesEnabled={legacyBrandGiftCardSalesEnabled()} />
    </div>
  );
}
