import type { Plan } from "@/lib/catalog";
import { cancelFleexaEmail, cancelFleexaSms, FleexaError } from "@/lib/fleexa";
import { expiryForPlan, provisionPlan } from "@/lib/provision";
import { isPreviewDatabase } from "@/lib/demo-policy";

export type FulfilledOrder = {
  provider: "fleexa" | "simulated";
  providerRequestId: string | null;
  referenceCode: string | null;
  otpCode: string | null;
  expiresAt: Date;
};

/**
 * Only the in-memory preview can issue simulated orders. Live purchases are
 * disabled until provider endpoints, catalog mappings and the financial
 * reconciliation workflow have been independently verified.
 */
export async function fulfillPlan(plan: Plan): Promise<FulfilledOrder> {
  if (!isPreviewDatabase()) {
    throw new FleexaError("Live fulfilment is temporarily unavailable", 503, "SERVICE_UNAVAILABLE");
  }
  const simulated = provisionPlan(plan);
  return {
    provider: "simulated",
    providerRequestId: null,
    referenceCode: simulated.referenceCode,
    otpCode: simulated.otpCode,
    expiresAt: expiryForPlan(plan),
  };
}

/** Used only for reconciliation of legacy orders; provider behavior is unverified. */
export async function cancelUpstream(order: {
  provider: string;
  providerRequestId: string | null;
  service: string;
}): Promise<void> {
  if (order.provider !== "fleexa" || !order.providerRequestId) return;
  if (order.service === "email-otp") {
    await cancelFleexaEmail(order.providerRequestId);
  } else {
    await cancelFleexaSms(order.providerRequestId);
  }
}
