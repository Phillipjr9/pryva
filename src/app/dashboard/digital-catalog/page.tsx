import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** Older links lead to the shared service catalogue, not a supplier-only shop. */
export default function DigitalCatalogPage() {
  redirect("/dashboard/services");
}
