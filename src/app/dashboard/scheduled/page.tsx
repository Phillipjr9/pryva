import Link from "next/link";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function ScheduledOrdersPage() {
  await requireUser("/dashboard/scheduled");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[1.5rem] font-medium tracking-tight text-ink sm:text-[1.7rem]">Scheduled Purchases</h1>
        <p className="mt-1 text-[0.86rem] text-ink-2">
          Recurring orders are not available yet.
        </p>
      </div>

      <div
        role="status"
        className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-[0.86rem] leading-relaxed text-amber-900"
      >
        Scheduled purchasing cannot be completed yet, so no schedule can be created, run or
        charged. Nothing on this page places an order.
      </div>

      <div className="rounded-xl border border-line bg-white p-6">
        <h2 className="text-[1rem] font-semibold text-ink">What you can do now</h2>
        <p className="mt-2 text-[0.86rem] leading-relaxed text-ink-2">
          Number and rental plans are delivered automatically when you order them, so you can
          repeat a purchase whenever you need one.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link href="/virtual-numbers" className="btn btn-primary">Buy a number plan</Link>
          <Link href="/dashboard/orders" className="btn btn-ghost">View your orders</Link>
        </div>
      </div>
    </div>
  );
}
