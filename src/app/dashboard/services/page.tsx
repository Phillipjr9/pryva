import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { ServiceExplorer } from "@/components/dashboard/ServiceExplorer";
import { isPreviewDatabase } from "@/lib/demo-policy";

export const metadata: Metadata = { title: "Service hub" };
export const dynamic = "force-dynamic";

export default async function DashboardServicesPage({
  searchParams,
}: {
  searchParams: Promise<{ country?: string | string[]; category?: string | string[] }>;
}) {
  await requireUser("/dashboard/services");
  const params = await searchParams;
  const country = typeof params.country === "string" ? params.country : null;
  const category = typeof params.category === "string" ? params.category : null;
  // Category links in the shell may navigate between queries on this same page.
  // A new key resets local filters when the server delivers a new selection.
  return <ServiceExplorer key={`${country ?? ""}:${category ?? ""}`} initialCountry={country} initialCategory={category} preview={isPreviewDatabase()} />;
}
