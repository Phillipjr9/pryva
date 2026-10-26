import { DataPlansForm } from "./DataPlansForm";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function DataPlansPage() {
  const user = await requireUser("/dashboard/data");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[1.5rem] font-medium tracking-tight">Data Plans</h1>
        <p className="mt-1 text-[0.86rem] text-ink-2">
          Purchase MTN, Airtel, Glo and 9mobile data plans instantly.
        </p>
      </div>
      <DataPlansForm user={user} />
    </div>
  );
}
