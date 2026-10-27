import { BulkOrdersForm } from "./BulkOrdersForm";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function BulkOrdersPage() {
  const user = await requireUser("/dashboard/bulk-orders");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[1.5rem] font-medium tracking-tight text-ink sm:text-[1.7rem]">Bulk Orders</h1>
        <p className="mt-1 text-[0.86rem] text-ink-2">
          Buy 10+ items and save 5%, or 20+ items and save 10%.
        </p>
      </div>
      <BulkOrdersForm user={user} />
    </div>
  );
}
