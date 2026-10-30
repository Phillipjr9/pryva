import { BulkOrdersForm } from "./BulkOrdersForm";
import { requireUser } from "@/lib/auth";
import { ServiceTitle } from "@/components/ServiceTitle";

export const dynamic = "force-dynamic";

export default async function BulkOrdersPage() {
  const user = await requireUser("/dashboard/bulk-orders");

  return (
    <div className="space-y-6">
      <div>
        <ServiceTitle service="bulk">Bulk Orders</ServiceTitle>
        <p className="mt-1 text-[0.86rem] text-ink-2">
          Build a basket to see volume discounts of up to 5% for 10+ items or 10% for 20+ items. Bulk purchasing is not available yet.
        </p>
      </div>
      <BulkOrdersForm user={user} />
    </div>
  );
}
