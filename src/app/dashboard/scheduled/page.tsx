import { ScheduledManager } from "./ScheduledManager";
import { requireUser } from "@/lib/auth";
import { findPlan, plans } from "@/lib/catalog";
import { fulfilmentIntent } from "@/lib/fulfillment";
import { getUserScheduledOrders } from "@/lib/scheduled-orders";
import { formatDateNigerian } from "@/lib/date-utils";
import { ServiceTitle } from "@/components/ServiceTitle";

export const dynamic = "force-dynamic";

/**
 * Whether a schedule is waiting on a retry.
 *
 * Kept out of the component body because the lint rule for render purity flags a
 * clock read there, and this page is force-dynamic anyway: every request renders
 * it against the current time, which is the point.
 */
function isDue(status: string, nextRun: Date): boolean {
  return status === "active" && nextRun.getTime() <= Date.now();
}

/**
 * Recurring purchases.
 *
 * This page used to say the feature did not exist, and it was right: the API and
 * the processor were both written, but nothing ever called the processor, so a
 * schedule would have been a promise no job kept. The nightly run now calls it,
 * so the page can offer the feature -- with the two limits stated plainly, because
 * both of them decide whether a customer is charged:
 *
 *   • one attempt a night, not an instant order;
 *   • a plan is bought and then charged, so a run that cannot deliver costs
 *     nothing and simply stays due.
 */
export default async function ScheduledOrdersPage() {
  const user = await requireUser("/dashboard/scheduled");
  const schedules = await getUserScheduledOrders(user.id);

  // Only plans with a supplier path may recur; createScheduledOrder refuses the
  // rest, and this page must not offer what the route will reject.
  const creatable = plans
    .filter((plan) => fulfilmentIntent(plan.slug))
    .map((plan) => ({
      slug: plan.slug,
      service: plan.service,
      name: plan.name,
      planLabel: plan.planLabel,
      price: plan.price,
    }));

  const rows = schedules.map((schedule) => {
    const plan = findPlan(schedule.productSlug);
    const nextRun = new Date(schedule.nextRunAt);
    const lastRun = schedule.lastRunAt ? new Date(schedule.lastRunAt) : null;
    return {
      id: schedule.id,
      status: schedule.status,
      frequency: schedule.frequency,
      productName: plan?.name ?? schedule.productSlug,
      planLabel: plan?.planLabel ?? "",
      price: plan?.price ?? null,
      nextRunLabel: formatDateNigerian(nextRun, { short: true, includeTime: true }),
      // A run that was skipped leaves nextRunAt in the past on purpose, so the
      // page can say "we tried and it did not go through" instead of showing a
      // date that has already passed with no explanation.
      due: isDue(schedule.status, nextRun),
      lastRunLabel: lastRun ? formatDateNigerian(lastRun, { short: true, includeTime: true }) : null,
      lastOrderId: schedule.lastOrderId ?? null,
    };
  });

  return (
    <div className="space-y-6">
      <div>
        <ServiceTitle service="scheduled">Scheduled Purchases</ServiceTitle>
        <p className="mt-1 text-[0.86rem] text-ink-2">
          Repeat a number plan automatically. We check your schedules once a night, buy the plan the
          same way an order is bought, and charge only what was delivered.
        </p>
      </div>
      <ScheduledManager
        rows={rows}
        creatable={creatable}
        balance={user.walletBalance}
      />
    </div>
  );
}
