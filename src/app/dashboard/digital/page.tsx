import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/identity/auth";
import { ServiceTitle } from "@/components/ServiceTitle";

export const metadata: Metadata = { title: "Subscriptions" };
export const dynamic = "force-dynamic";

export default async function DigitalServicesPage() {
  await requireUser("/dashboard/digital");
  return (
    <div className="grid gap-4">
      <div>
        <ServiceTitle service="accounts">Digital subscriptions</ServiceTitle>
        <p className="mt-1 max-w-xl text-[0.86rem] text-ink-2">Subscriptions are not currently available to order. No wallet charge will be made.</p>
      </div>
      <div className="rounded-2xl border border-line bg-white p-6">
        <p className="text-[0.9rem] leading-relaxed text-ink-2">When a delivery service is connected, current plans and pricing will be shown here.</p>
        <Link href="/dashboard/digital-catalog" className="mt-4 mr-5 inline-flex font-semibold text-lav-700 underline underline-offset-2">Explore the digital catalogue</Link>
        <Link href="/dashboard/accounts" className="mt-4 inline-flex font-semibold text-lav-700 underline underline-offset-2">Browse account listings</Link>
      </div>
    </div>
  );
}
