import { randomUUID } from "node:crypto";
import { db } from "@/db";
import { orders } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  cancelFleexaOrder,
  createFleexaOrder,
  isFleexaConfigured,
  pollForOtp,
} from "./fleexa";
import { getServiceTimeout } from "./service-timeouts";
import type { Plan } from "./catalog";
import { logger } from "./logger";

export type FulfilledPlan = {
  provider: string;
  providerRequestId: string | null;
  referenceCode: string | null;
  otpCode: string | null;
  expiresAt: Date | null;
};

/**
 * Provision a plan upstream *before* the wallet is charged.
 *
 * When the provider isn't configured (local preview, no keys) we return a
 * clearly-marked simulated result instead of throwing, so the purchase flow
 * stays testable end to end.
 */
export async function fulfillPlan(plan: Plan): Promise<FulfilledPlan> {
  if (!isFleexaConfigured()) {
    logger.warn("Fulfilment simulated — provider not configured", { planSlug: plan.slug });
    return {
      provider: "simulated",
      providerRequestId: null,
      referenceCode: `SIM-${randomUUID().slice(0, 8).toUpperCase()}`,
      otpCode: null,
      expiresAt: null,
    };
  }

  const upstream = await createFleexaOrder({
    service: plan.service,
    country: plan.provider?.country ?? (plan.region === "Nigeria" ? "ng" : plan.region.toLowerCase()),
    app: plan.provider?.app,
    emailProduct: plan.provider?.emailProduct,
    months: plan.provider?.months,
  });

  return {
    provider: "fleexa",
    providerRequestId: upstream.orderId,
    referenceCode: upstream.number ?? upstream.email ?? upstream.proxyEndpoint ?? null,
    otpCode: null,
    expiresAt: upstream.expiresAt ? new Date(upstream.expiresAt) : null,
  };
}

/**
 * Best-effort cancel of an upstream order. Used when the wallet charge fails
 * after provisioning succeeded, so we don't leave a paid upstream order behind.
 */
export async function cancelUpstream(input: {
  provider: string;
  providerRequestId: string | null;
  service: string;
}): Promise<void> {
  if (input.provider !== "fleexa" || !input.providerRequestId) return;
  await cancelFleexaOrder(input.providerRequestId);
}

export async function fulfillOrder(orderId: string): Promise<void> {
  const order = await db.query.orders.findFirst({
    where: eq(orders.id, orderId),
  });

  if (!order) {
    throw new Error("Order not found");
  }

  if (order.status !== "active") {
    logger.warn("Order not in active state", { orderId, status: order.status });
    return;
  }

  try {
    logger.info("Starting order fulfillment", { orderId, service: order.service });

    // Create Fleexa order
    const fleexaOrder = await createFleexaOrder({
      service: order.service,
      country: order.region === "Nigeria" ? "ng" : order.region.toLowerCase(),
      app: order.service === "numbers" ? "whatsapp" : undefined,
    });

    // Update order with provider details
    await db
      .update(orders)
      .set({
        provider: "fleexa",
        providerRequestId: fleexaOrder.orderId,
        referenceCode: fleexaOrder.number || fleexaOrder.email || fleexaOrder.proxyEndpoint,
      })
      .where(eq(orders.id, orderId));

    // For virtual numbers, poll for OTP
    if (order.service === "numbers") {
      const timeout = getServiceTimeout(order.service);
      const otp = await pollForOtp(fleexaOrder.orderId, timeout.retryAttempts, timeout.retryDelay);

      if (otp) {
        await db
          .update(orders)
          .set({
            otpCode: otp,
            status: "delivered",
          })
          .where(eq(orders.id, orderId));

        logger.info("OTP received successfully", { orderId, otp });
      } else {
        logger.warn("OTP not received within timeout", { orderId });
        // Auto-refund will handle this
      }
    } else {
      // For other services, mark as delivered immediately
      await db
        .update(orders)
        .set({ status: "delivered" })
        .where(eq(orders.id, orderId));

      logger.info("Order delivered successfully", { orderId });
    }
  } catch (error) {
    logger.error("Order fulfillment failed", { orderId, error });
    // Auto-refund will handle this
  }
}

export async function getOrderDetails(orderId: string) {
  const order = await db.query.orders.findFirst({
    where: eq(orders.id, orderId),
  });

  if (!order) {
    return null;
  }

  return {
    id: order.id,
    reference: order.reference,
    service: order.service,
    productName: order.productName,
    amount: order.amount,
    status: order.status,
    referenceCode: order.referenceCode,
    otpCode: order.otpCode,
    expiresAt: order.expiresAt,
    createdAt: order.createdAt,
  };
}
