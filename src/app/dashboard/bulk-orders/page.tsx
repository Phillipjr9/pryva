import { BulkOrdersForm } from "./BulkOrdersForm";
import { requireUser } from "@/lib/auth";
import { fulfilablePlans } from "@/lib/fulfillment";
import { MAX_BULK_UNITS } from "@/lib/bulk-orders";
import { ServiceTitle } from "@/components/ServiceTitle";

export const dynamic = "force-dynamic";

export default async function BulkOrdersPage() {
  const user = await requireUser("/dashboard/bulk-orders");
  // Only plans with a supplier path are offered: the checkout refuses anything
  // else, so showing it here would be an invitation to a guaranteed failure.
  const sellableSlugs = fulfilablePlans().map(({ plan }) => plan.slug);

  return (
    <div className="space-y-6">
      <div>
        <ServiceTitle service="bulk">Bulk Orders</ServiceTitle>
        <p className="mt-1 text-[0.86rem] text-ink-2">
          Buy several number plans in one go. Items are delivered automatically, and a basket of
          10+ saves 5% — 20 items saves 10%, up to {MAX_BULK_UNITS} items per checkout.
        </p>
      </div>
      <BulkOrdersForm user={user} sellableSlugs={sellableSlugs} maxUnits={MAX_BULK_UNITS} />
    </div>
  );
}
