import { notFound } from "next/navigation";
import { DataPlansForm } from "./DataPlansForm";
import { requireUser } from "@/lib/auth";
import { findDataPlan } from "@/lib/airtime";
import { ServiceTitle } from "@/components/ServiceTitle";

export const dynamic = "force-dynamic";

export default async function DataPlansPage({ searchParams }: { searchParams: Promise<{ plan?: string | string[] }> }) {
  const user = await requireUser("/dashboard/data");
  const { plan } = await searchParams;
  const initialPlan = typeof plan === "string" ? findDataPlan(plan) : undefined;
  if (plan !== undefined && !initialPlan) notFound();

  return (
    <div className="space-y-6">
      <div>
        <ServiceTitle service="data">Data Plans</ServiceTitle>
        <p className="mt-1 text-[0.86rem] text-ink-2">
          Browse data plans and pricing. Data plans cannot be delivered yet.
        </p>
      </div>
      <DataPlansForm key={initialPlan?.id ?? "all"} user={user} initialPlanId={initialPlan?.id} />
    </div>
  );
}
