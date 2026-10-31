import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { ServiceExplorer } from "@/components/dashboard/ServiceExplorer";
import { explorerCategory, explorerCountry } from "@/lib/service-explorer";
import { readServiceReadiness } from "@/lib/service-readiness";

export const metadata: Metadata = { title: "Service hub" };
export const dynamic = "force-dynamic";

export default async function DashboardServicesPage({
  searchParams,
}: {
  searchParams: Promise<{ country?: string | string[]; category?: string | string[] }>;
}) {
  await requireUser("/dashboard/services");
  const params = await searchParams;
  const readiness = readServiceReadiness();
  const country = typeof params.country === "string" ? params.country : null;
  const category = typeof params.category === "string" ? params.category : null;
  // An unrecognisable link value falls back to the picker rather than 404ing,
  // but the fallback must be visible: silently showing a different selection is
  // how somebody ends up ordering for the wrong country.
  const rejectedCountry = country && !explorerCountry(country) ? country : null;
  const rejectedCategory = category && explorerCategory(category) === "all" ? category : null;
  // Category links in the shell may navigate between queries on this same page.
  // A new key resets local filters when the server delivers a new selection.
  return (
    <ServiceExplorer
      key={`${country ?? ""}:${category ?? ""}`}
      initialCountry={country}
      initialCategory={category}
      rejectedCountry={rejectedCountry}
      rejectedCategory={rejectedCategory}
      readiness={readiness}
    />
  );
}
