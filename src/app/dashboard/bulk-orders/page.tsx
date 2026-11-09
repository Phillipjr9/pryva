import { requireUser } from "@/lib/identity/auth";
import { ServiceTitle } from "@/components/ServiceTitle";
import { plans } from "@/lib/services/catalog";
import { isNumberPlanOrderingConfigured } from "@/lib/services/numbers/number-availability";
import { MAX_BULK_UNITS } from "@/lib/services/bulk-orders";
import { BulkOrdersForm } from "./BulkOrdersForm";

export const dynamic = "force-dynamic";

export default async function BulkOrdersPage() {
  const user = await requireUser("/dashboard/bulk-orders");
  const sellable = plans.filter((plan) => plan.service === "numbers" && isNumberPlanOrderingConfigured(plan.slug)).map((plan) => plan.slug);
  return (
    <div className="space-y-6">
      <ServiceTitle service="bulk">Bulk Orders</ServiceTitle>
      <p className="text-sm text-ink-2">Availability is checked per unit. If an outcome is uncertain, the batch stops for review; check your orders before buying again.</p>
      {sellable.length ? <BulkOrdersForm user={user} sellableSlugs={sellable} maxUnits={MAX_BULK_UNITS} /> : <p role="status">Bulk ordering is currently unavailable.</p>}
    </div>
  );
}
