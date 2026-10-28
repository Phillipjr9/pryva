import { randomUUID } from "node:crypto";
import { mutatePreviewDatabase } from "@/db";
import { findPlan } from "@/lib/catalog";
import { DemoBalanceError, DemoConflict, DEMO_REQUEST_ID, demoReference } from "@/lib/demo-wallet";
import { demoPlanUnits } from "@/lib/demo-service-catalog";
import { expiryForPlan, provisionPlan } from "@/lib/provision";
import { calculateNextRun, type Frequency } from "@/lib/scheduled-orders";

export class DemoScheduleError extends Error {}

/** Explicit manual run only; never contacts a provider or starts a live scheduler. */
export function runDemoSchedule(input: { userId: string; scheduleId: string; requestId: string }) {
  if (!DEMO_REQUEST_ID.test(input.requestId)) throw new Error("Invalid request ID");
  const reference = demoReference("DSCH", input.userId, input.requestId);
  return mutatePreviewDatabase((draft) => {
    const account = draft.users.find((row) => row.id === input.userId);
    if (!account || typeof account.walletBalance !== "number" || !Number.isSafeInteger(account.walletBalance)) throw new DemoBalanceError("Demo wallet not found.");
    const previous = draft.orders.find((row) => row.userId === input.userId && row.reference === reference);
    if (previous) {
      if (previous.demoScheduleId !== input.scheduleId) throw new DemoConflict("This demo request was already used for another schedule.");
      return { orderId: String(previous.id), reference, duplicate: true };
    }
    const schedule = draft.scheduledOrders.find((row) => row.id === input.scheduleId && row.userId === input.userId);
    if (!schedule || schedule.status !== "active" || typeof schedule.productSlug !== "string") throw new DemoScheduleError("Choose an active demo schedule.");
    const plan = findPlan(schedule.productSlug);
    if (!plan || plan.service !== schedule.service || !["daily", "weekly", "biweekly", "monthly"].includes(String(schedule.frequency))) throw new DemoScheduleError("This demo schedule is invalid.");
    if (account.walletBalance < plan.price) throw new DemoBalanceError("Your demo wallet balance is too low. Add demo funds to continue.");
    const simulated = provisionPlan(plan);
    const now = new Date();
    const balance = account.walletBalance - plan.price;
    const orderId = randomUUID();
    account.walletBalance = balance;
    draft.orders.push({
      id: orderId, reference, userId: input.userId, service: plan.service, productSlug: plan.slug, productName: plan.name,
      planLabel: `Demo schedule · ${plan.planLabel}`, region: plan.region, duration: plan.duration, amount: plan.price,
      status: "active", provider: "simulated", providerRequestId: null, referenceCode: simulated.referenceCode, otpCode: simulated.otpCode,
      accounts: null, expiresAt: expiryForPlan(plan), refundedAt: null, createdAt: now, demoScheduleId: input.scheduleId,
      demoUnitsPurchased: demoPlanUnits(plan.slug), demoUnitsRemaining: demoPlanUnits(plan.slug),
    });
    draft.walletTransactions.push({ id: randomUUID(), userId: input.userId, orderId, type: "debit", amount: plan.price, balanceAfter: balance, description: `Demo scheduled order · ${plan.name}`, reference, createdAt: now });
    schedule.lastRunAt = now;
    schedule.lastOrderId = orderId;
    schedule.nextRunAt = calculateNextRun(schedule.frequency as Frequency, now);
    return { orderId, reference, duplicate: false };
  });
}
