import { notFound } from "next/navigation";
import { DataPlansForm } from "./DataPlansForm";
import { requireUser } from "@/lib/auth";
import { findDataPlan } from "@/lib/airtime";

export const dynamic = "force-dynamic";

export default async function DataPlansPage({ searchParams }: { searchParams: Promise<{ plan?: string | string[] }> }) {
  const user = await requireUser("/dashboard/data");
  const { plan } = await searchParams;
  const initialPlan = typeof plan === "string" ? findDataPlan(plan) : undefined;
  if (plan !== undefined && !initialPlan) notFound();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[1.5rem] font-medium tracking-tight text-ink sm:text-[1.7rem]">Data Plans</h1>
        <p className="mt-1 text-[0.86rem] text-ink-2">
          Browse data plans and pricing. Data plans cannot be delivered yet.
        </p>
      </div>
      <DataPlansForm key={initialPlan?.id ?? "all"} user={user} initialPlanId={initialPlan?.id} />
    </div>
  );
}
