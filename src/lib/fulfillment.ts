import type { Plan } from "@/lib/catalog";
import {
  buyFleexaEmail,
  buyFleexaRental,
  buyFleexaSmsNumber,
  cancelFleexaEmail,
  cancelFleexaSms,
  isFleexaConfigured,
} from "@/lib/fleexa";
import { expiryForPlan, provisionPlan } from "@/lib/provision";

export type FulfilledOrder = {
  provider: "fleexa" | "simulated";
  providerRequestId: string | null;
  referenceCode: string | null;
  otpCode: string | null;
  expiresAt: Date;
};

function isRent(plan: Plan): boolean {
  return plan.service === "numbers" && plan.duration.startsWith("Rent");
}

/**
 * A plan is fulfilled through Fleexa's developer API whenever an API key is
 * configured and the plan carries provider metadata. eSIM and proxy plans
 * remain simulated — they are ordered through the Fleexa dashboard rather
 * than the developer API.
 */
export function planComesFromFleexa(plan: Plan): boolean {
  if (!isFleexaConfigured() || !plan.provider) return false;
  return plan.service === "numbers" || plan.service === "email-otp";
}

export async function fulfillPlan(plan: Plan): Promise<FulfilledOrder> {
  if (!planComesFromFleexa(plan)) {
    const simulated = provisionPlan(plan);
    return {
      provider: "simulated",
      providerRequestId: null,
      referenceCode: simulated.referenceCode,
      otpCode: simulated.otpCode,
      expiresAt: expiryForPlan(plan),
    };
  }

  if (plan.service === "email-otp") {
    const order = await buyFleexaEmail({
      product: plan.provider?.emailProduct !== "auto" ? plan.provider?.emailProduct : undefined,
    });
    const expiresAt = order.expiresAt ? new Date(order.expiresAt) : expiryForPlan(plan);
    return {
      provider: "fleexa",
      providerRequestId: order.emailId,
      referenceCode: order.address,
      otpCode: null,
      expiresAt: Number.isNaN(expiresAt.getTime()) ? expiryForPlan(plan) : expiresAt,
    };
  }

  if (isRent(plan)) {
    const order = await buyFleexaRental({
      area: plan.provider?.country,
      months: plan.provider?.months,
    });
    const expiresAt = order.expiresAt ? new Date(order.expiresAt) : expiryForPlan(plan);
    return {
      provider: "fleexa",
      providerRequestId: order.rentalId,
      referenceCode: order.number,
      otpCode: null,
      expiresAt: Number.isNaN(expiresAt.getTime()) ? expiryForPlan(plan) : expiresAt,
    };
  }

  const order = await buyFleexaSmsNumber({
    app: plan.provider?.app,
    country: plan.provider?.country,
  });
  const expiresAt = order.expiresAt ? new Date(order.expiresAt) : expiryForPlan(plan);
  return {
    provider: "fleexa",
    providerRequestId: order.requestId,
    referenceCode: order.number,
    otpCode: null,
    expiresAt: Number.isNaN(expiresAt.getTime()) ? expiryForPlan(plan) : expiresAt,
  };
}

/** Best-effort upstream cancellation so Fleexa's wallet gets refunded. */
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
