import { randomUUID } from "node:crypto";
import { mutatePreviewDatabase, readPreviewDatabase, type PreviewState } from "@/db";
import { digitalServices, getDigitalPlan } from "@/lib/digital-services";
import { DemoBalanceError, DemoConflict, DEMO_REQUEST_ID, demoReference } from "@/lib/demo-wallet";
import { explorerCountry } from "@/lib/service-explorer";

export class DemoDigitalStockError extends Error {}
export type DemoDigitalInventory = Record<string, { stock: number; owned: number }>;

export function demoDigitalInventoryIn(state: PreviewState, userId: string): DemoDigitalInventory {
  const result: DemoDigitalInventory = {};
  for (const service of digitalServices) for (const plan of service.plans) {
    const rows = state.orders.filter((order) => order.provider === "simulated" && order.demoDigitalPlan === plan.id && order.status === "delivered");
    const now = Date.now();
    result[plan.id] = {
      stock: Math.max(0, 250 - rows.length),
      owned: rows.filter((order) => order.userId === userId && (!order.expiresAt || new Date(order.expiresAt as Date | string).getTime() > now)).length,
    };
  }
  return result;
}

export function demoDigitalInventory(userId: string): DemoDigitalInventory {
  return readPreviewDatabase((state) => demoDigitalInventoryIn(state, userId));
}

export function purchaseDemoDigital(input: { userId: string; planId: string; requestId: string; countryCode?: string }) {
  if (!DEMO_REQUEST_ID.test(input.requestId)) throw new Error("Invalid request ID");
  const info = getDigitalPlan(input.planId);
  const country = input.countryCode === undefined ? null : explorerCountry(input.countryCode);
  if (!info || (input.countryCode !== undefined && !country)) throw new Error("Invalid demo plan or country");
  const { plan, service } = info;
  const reference = demoReference("DDIG", input.userId, input.requestId);
  return mutatePreviewDatabase((draft) => {
    const account = draft.users.find((row) => row.id === input.userId);
    if (!account || typeof account.walletBalance !== "number" || !Number.isSafeInteger(account.walletBalance)) throw new DemoBalanceError("Demo wallet not found.");
    const previous = draft.orders.find((row) => row.userId === input.userId && row.reference === reference);
    if (previous) {
      if (previous.demoDigitalPlan !== plan.id || (previous.demoDigitalCountry ?? null) !== (country?.code ?? null)) throw new DemoConflict("This demo request was already used for another selection.");
      return { orderId: String(previous.id), reference, duplicate: true };
    }
    if ((demoDigitalInventoryIn(draft, input.userId)[plan.id]?.stock ?? 0) < 1) throw new DemoDigitalStockError("This demo plan is out of stock.");
    if (account.walletBalance < plan.price) throw new DemoBalanceError("Your demo wallet balance is too low. Add demo funds to continue.");
    const now = new Date();
    const days = Number(plan.duration.match(/(\d+)\s*days?/i)?.[1] ?? 30);
    const balance = account.walletBalance - plan.price;
    const id = randomUUID();
    account.walletBalance = balance;
    draft.orders.push({
      id, reference, userId: input.userId, service: "digital", productSlug: service.slug, productName: plan.name, planLabel: plan.duration,
      // Country is only the user's browsing context, never proof of coverage.
      region: country?.name ?? "Demo", duration: plan.duration, amount: plan.price, status: "delivered", provider: "simulated", providerRequestId: null,
      referenceCode: "Fictional demo subscription · no account access", otpCode: null, accounts: null,
      expiresAt: new Date(now.getTime() + days * 86_400_000), refundedAt: null, createdAt: now, demoDigitalPlan: plan.id, demoDigitalCountry: country?.code ?? null,
    });
    draft.walletTransactions.push({ id: randomUUID(), userId: input.userId, orderId: id, type: "debit", amount: plan.price, balanceAfter: balance, description: `Demo subscription · ${plan.name}`.slice(0, 200), reference, createdAt: now });
    return { orderId: id, reference, duplicate: false };
  });
}
