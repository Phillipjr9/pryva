import Link from "next/link";
import { requireUser } from "@/lib/identity/auth";
import { ServiceIcon } from "@/components/ServiceIcon";
import { CallOfDutyBrowser } from "./CallOfDutyBrowser";

export const dynamic = "force-dynamic";

export default async function CallOfDutyMobilePage() {
  await requireUser("/dashboard/call-of-duty-mobile");
  return <div className="space-y-5">
    <Link href="/dashboard/services?category=topups" className="text-meta font-semibold text-lav-700 underline">← Account top-ups</Link>
    <div className="flex items-start gap-4"><ServiceIcon service="games" size="md" /><div>
      <h1 className="text-[1.6rem] font-semibold text-ink">Call of Duty: Mobile CP</h1>
      <p className="mt-2 text-[0.9rem] text-ink-2">Browse Activision CP top-ups by the region where your account is registered.</p>
    </div></div>
    <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-meta text-amber-900">For the Activision version only, not Garena. Choose your account region carefully. Reported stock does not guarantee checkout; only reviewed products can be ordered.</p>
    <CallOfDutyBrowser />
  </div>;
}
