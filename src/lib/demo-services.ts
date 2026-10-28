import { randomInt, randomUUID } from "node:crypto";
import { mutatePreviewDatabase, readPreviewDatabase, type PreviewState } from "@/db";
import { findPlan } from "@/lib/catalog";
import { findDataPlan } from "@/lib/airtime";
import { getDigitalService } from "@/lib/digital-services";
import { demoDigitalInventoryIn } from "@/lib/demo-digital";
import { demoServiceTerms, type DemoInventory } from "@/lib/demo-service-catalog";
import { demoServicePresentation } from "@/lib/demo-service-presentation";
import { buildServiceExplorer, explorerCountry } from "@/lib/service-explorer";
import { DEMO_REQUEST_ID, DemoBalanceError, DemoConflict, demoReference } from "@/lib/demo-wallet";
import { expiryForPlan, provisionPlan } from "@/lib/provision";

export function demoService(itemId: string, countryCode: string) {
  const country = explorerCountry(countryCode);
  if (!country) return null;
  const item = buildServiceExplorer(country.code).find((candidate) => candidate.id === itemId);
  if (!item) return null;
  const terms = demoServiceTerms(item);
  if (!terms) return null;
  const plan = item.id.startsWith("plan-") ? findPlan(item.id.slice(5)) : undefined;
  const dataPlan = item.id.startsWith("data-") ? findDataPlan(item.id.slice(5)) : undefined;
  if (item.id.startsWith("plan-") && !plan || item.id.startsWith("data-") && !dataPlan) return null;
  const selection = { country, item, terms, plan, dataPlan };
  // A category without a faithful demo experience cannot be ordered via API either.
  return demoServicePresentation(selection) ? selection : null;
}

function inventoryIn(snapshot: PreviewState, userId: string, countryCode: string): DemoInventory {
  const items = buildServiceExplorer(countryCode);
  const inventory: DemoInventory = {};
  const digitalCounts = demoDigitalInventoryIn(snapshot, userId);
  const now = Date.now();
  for (const item of items) {
    if (item.id.startsWith("subscription-")) {
      const service = getDigitalService(item.id.slice("subscription-".length));
      if (service) inventory[item.id] = service.plans.reduce((total, plan) => ({ stock: total.stock + (digitalCounts[plan.id]?.stock ?? 0), owned: total.owned + (digitalCounts[plan.id]?.owned ?? 0) }), { stock: 0, owned: 0 });
      continue;
    }
    const terms = demoServiceTerms(item);
    if (!terms) continue;
    let used = 0;
    let owned = 0;
    for (const order of snapshot.orders) {
      if (order.provider !== "simulated" || order.demoCountry !== countryCode || order.demoItemId !== item.id || order.status === "refunded") continue;
      const purchased = typeof order.demoUnitsPurchased === "number" && Number.isSafeInteger(order.demoUnitsPurchased) ? order.demoUnitsPurchased : 0;
      const remaining = typeof order.demoUnitsRemaining === "number" && Number.isSafeInteger(order.demoUnitsRemaining) ? order.demoUnitsRemaining : 0;
      used += Math.max(0, purchased);
      const expires = order.expiresAt ? new Date(order.expiresAt as Date | string).getTime() : Infinity;
      if (order.userId === userId && expires > now) owned += Math.max(0, remaining);
    }
    inventory[item.id] = { stock: Math.max(0, terms.stock - used), owned };
  }
  return inventory;
}

/** Snapshot of simulated stock and explicitly tracked, unconsumed demo units. */
export function demoInventory(userId: string, countryCode: string): DemoInventory {
  const country = explorerCountry(countryCode);
  if (!country) return {};
  return readPreviewDatabase((snapshot) => inventoryIn(snapshot, userId, country.code));
}

export class DemoStockError extends Error {}

/** One atomic preview debit, stock reservation, unit balance and order record. */
export function purchaseDemoService(input: { userId: string; itemId: string; countryCode: string; requestId: string }) {
  if (!DEMO_REQUEST_ID.test(input.requestId)) throw new Error("Invalid request ID");
  const selection = demoService(input.itemId, input.countryCode);
  if (!selection) throw new Error("Invalid demo service");
  const { item, country, terms, plan, dataPlan } = selection;
  const reference = demoReference("DSRV", input.userId, input.requestId);

  return mutatePreviewDatabase((draft) => {
    const account = draft.users.find((row) => row.id === input.userId);
    if (!account || typeof account.walletBalance !== "number" || !Number.isSafeInteger(account.walletBalance)) throw new DemoBalanceError("Demo wallet not found.");
    const previous = draft.orders.find((order) => order.userId === input.userId && order.reference === reference);
    if (previous) {
      if (previous.demoItemId !== item.id || previous.demoCountry !== country.code) throw new DemoConflict("This demo request was already used for another service.");
      return { orderId: String(previous.id), reference, balance: account.walletBalance, duplicate: true };
    }
    const counts = inventoryIn(draft, input.userId, country.code)[item.id];
    if (!counts || counts.stock < terms.units) throw new DemoStockError("There are not enough demo units left for this order.");
    if (account.walletBalance < terms.price) throw new DemoBalanceError("Your demo wallet balance is too low. Add demo funds to continue.");

    const id = randomUUID();
    const now = new Date();
    const isVerification = item.category === "verification";
    const isPromotion = item.category === "social";
    const simulated = plan ? provisionPlan(plan) : {
      referenceCode: dataPlan ? "Fictional demo mobile" : isVerification ? `+000 555 ${String(randomInt(10000)).padStart(4, "0")}` : "Demo campaign · fictional profile",
      otpCode: null,
    };
    const service = dataPlan ? "data" : plan?.service ?? (isVerification ? "numbers" : "social");
    const expiresAt = dataPlan ? new Date(now.getTime() + 30 * 24 * 60 * 60_000) : plan ? expiryForPlan(plan) : isVerification ? new Date(now.getTime() + 20 * 60_000) : null;
    const balance = account.walletBalance - terms.price;
    account.walletBalance = balance;
    draft.orders.push({
      id, reference, userId: input.userId, service, productSlug: item.id,
      productName: isVerification ? `${item.name} verification` : item.name,
      planLabel: dataPlan ? `${dataPlan.size} · ${dataPlan.duration}` : isPromotion ? `${terms.units} demo ${item.tag.toLowerCase()}` : plan?.planLabel ?? "Demo SMS verification",
      region: country.name, duration: dataPlan?.duration ?? plan?.duration ?? (isVerification ? "Single verification · 20 min window" : "Demo campaign"),
      amount: terms.price, status: isPromotion ? "processing" : dataPlan ? "delivered" : "active", provider: "simulated", providerRequestId: null,
      referenceCode: simulated.referenceCode, otpCode: simulated.otpCode, accounts: null, expiresAt, refundedAt: null, createdAt: now,
      demoCountry: country.code, demoItemId: item.id, demoUnitsPurchased: terms.units, demoUnitsRemaining: terms.units,
    });
    draft.walletTransactions.push({
      id: randomUUID(), userId: input.userId, orderId: id, type: "debit", amount: terms.price, balanceAfter: balance,
      description: `Demo order · ${item.name}`.slice(0, 200), reference, createdAt: now,
    });
    return { orderId: id, reference, balance, duplicate: false };
  });
}
