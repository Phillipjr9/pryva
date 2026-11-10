import Link from "next/link";
import { requireUser } from "@/lib/identity/auth";
import { ServiceIcon } from "@/components/ServiceIcon";
import { CallOfDutyBrowser } from "./CallOfDutyBrowser";

export const dynamic = "force-dynamic";

export default async function CallOfDutyMobilePage() {
  await requireUser("/dashboard/call-of-duty-mobile");
  return <div className="grid min-w-0 gap-4">
    <Link href="/dashboard/services?category=topups" className="w-fit text-meta font-semibold text-lav-700 hover:underline">← Account top-ups</Link>
    <div className="flex min-w-0 items-start gap-3 sm:gap-4"><ServiceIcon service="games" size="md" decorative /><div className="min-w-0">
      <p className="text-micro font-bold uppercase tracking-[0.16em] text-lav-700">Account top-up</p>
      <h1 className="mt-1 text-[1.6rem] font-semibold leading-tight text-ink sm:text-[1.9rem]">Call of Duty: Mobile CP</h1>
      <p className="mt-1.5 max-w-2xl text-[0.82rem] leading-relaxed text-ink-2">Browse Activision CP top-ups by the region where your account is registered.</p>
    </div></div>
    <p role="note" className="rounded-2xl border border-amber-200 bg-amber-50/80 px-4 py-3 text-meta leading-relaxed text-amber-900">For the Activision version only, not Garena. Choose your account region carefully. Reported stock does not guarantee checkout; only reviewed products can be ordered.</p>
    <CallOfDutyBrowser />
  </div>;
}
