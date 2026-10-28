import { DataPlansForm } from "./DataPlansForm";
import { requireUser } from "@/lib/auth";
import { findDataPlan } from "@/lib/airtime";
import { isPreviewDatabase } from "@/lib/demo-policy";
import { demoInventory } from "@/lib/demo-services";

export const dynamic = "force-dynamic";

export default async function DataPlansPage({ searchParams }: { searchParams: Promise<{ plan?: string | string[] }> }) {
  const user = await requireUser("/dashboard/data");
  const { plan } = await searchParams;
  const initialPlan = typeof plan === "string" ? findDataPlan(plan) : undefined;
  const preview = isPreviewDatabase();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[1.5rem] font-medium tracking-tight text-ink sm:text-[1.7rem]">Data Plans</h1>
        <p className="mt-1 text-[0.86rem] text-ink-2">
          {preview ? "Explore simulated data plans and try a demo checkout." : "Browse data plans. Live fulfillment is paused."}
        </p>
      </div>
      <DataPlansForm user={user} initialPlanId={initialPlan?.id} preview={preview} inventory={preview ? demoInventory(user.id, "ng") : undefined} />
    </div>
  );
}
