import { GiftCardsManager } from "./GiftCardsManager";
import { requireUser } from "@/lib/auth";
import { ServiceTitle } from "@/components/ServiceTitle";

export const dynamic = "force-dynamic";

export default async function GiftCardsPage() {
  const user = await requireUser("/dashboard/gift-cards");

  return (
    <div className="space-y-6">
      <div>
        <ServiceTitle service="gift-cards">Gift Cards</ServiceTitle>
        <p className="mt-1 text-[0.86rem] text-ink-2">
          Buy international digital gift cards (Steam, Apple, Google Play, PlayStation, Xbox, Amazon) with instant delivery, or send Pryva wallet credit.
        </p>
      </div>
      <GiftCardsManager user={user} />
    </div>
  );
}
