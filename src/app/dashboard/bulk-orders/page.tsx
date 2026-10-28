import { BulkOrdersForm } from "./BulkOrdersForm";
import { requireUser } from "@/lib/auth";
import { isPreviewDatabase } from "@/lib/demo-policy";

export const dynamic = "force-dynamic";

export default async function BulkOrdersPage() {
  const user = await requireUser("/dashboard/bulk-orders");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[1.5rem] font-medium tracking-tight text-ink sm:text-[1.7rem]">Bulk Orders</h1>
        <p className="mt-1 text-[0.86rem] text-ink-2">
          Preview basket discounts of up to 5% for 10+ items or 10% for 20+ items; the applied rate may be lower.
        </p>
      </div>
      <BulkOrdersForm user={user} preview={isPreviewDatabase()} />
    </div>
  );
}
