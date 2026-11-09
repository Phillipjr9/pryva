import Link from "next/link";
import { requireAdmin } from "@/lib/identity/auth";
import { FoxreloadCheck } from "./FoxreloadCheck";

export const dynamic = "force-dynamic";
export default async function FoxreloadAdminPage() {
  await requireAdmin("/admin/foxreload");
  return <div className="grid gap-5">
    <Link href="/admin/services" className="w-fit text-meta font-semibold text-lav-700 underline">← Service coverage</Link>
    <div><h1 className="text-[1.6rem] font-semibold text-ink">FoxReload readiness</h1><p className="mt-2 text-ink-2">Check the configured account and sales settings without revealing the API key or creating an order.</p></div>
    <FoxreloadCheck />
    <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-meta text-amber-900">An active account or positive balance does not confirm product availability, pricing or delivery. Reviews, supplier-specific testing and reconciliation remain necessary before enabling sales.</p>
  </div>;
}
