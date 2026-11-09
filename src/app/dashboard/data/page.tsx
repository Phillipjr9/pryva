import Link from "next/link";
import { notFound } from "next/navigation";
import { DataPlansForm } from "./DataPlansForm";
import { requireUser } from "@/lib/identity/auth";
import { findDataPlan } from "@/lib/services/data/airtime";
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
          Mobile data purchases are not available yet. No wallet charge will be made.
        </p>
      </div>
      <DataPlansForm key={initialPlan?.id ?? "all"} user={user} initialPlanId={initialPlan?.id} />
      <Link href="/dashboard/digital-catalog" className="inline-block text-meta font-semibold text-lav-700 underline">Explore the digital catalogue (read-only)</Link>
    </div>
  );
}
