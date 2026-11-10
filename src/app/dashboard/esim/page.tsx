import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** Keep old eSIM links working while browsing both catalogues in one category. */
export default function EsimCataloguePage() {
  redirect("/dashboard/services?category=esim&allDestinations=1");
}
