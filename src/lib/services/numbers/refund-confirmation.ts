import "server-only";

import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { orders } from "@/db/schema";
import { logger } from "@/lib/platform/logger";
import { isNumberProvider } from "@/lib/services/order-providers";
import { readNumberCode } from "@/lib/services/numbers/number-code-sync";

/**
 * Check the final provider state before paying an automatic number refund.
 * A local lack of code is not evidence that the provider never delivered one.
 * Unknown, pending, missing reference and read failures are held for a later
 * check or support review; they are never treated as a definitive refusal.
 */
export async function confirmNumberRefund(order: {
  id: string;
  provider: string | null;
  providerRequestId: string | null;
}): Promise<"refundable" | "delivered" | "unconfirmed"> {
  if (!order.provider || !isNumberProvider(order.provider) || !order.providerRequestId) return "unconfirmed";
  try {
    const result = await readNumberCode({ provider: order.provider, providerRequestId: order.providerRequestId });
    if (result.code) {
      await db.update(orders).set({ otpCode: result.code, codeReceivedAt: new Date(), status: "delivered" })
        .where(and(eq(orders.id, order.id), inArray(orders.status, ["active", "expired"]), isNull(orders.refundedAt), isNull(orders.otpCode)));
      return "delivered";
    }
    if (result.status === "expired" || result.status === "cancelled") return "refundable";
    return "unconfirmed";
  } catch {
    logger.warn("Final number status could not be confirmed", { orderId: order.id });
    return "unconfirmed";
  }
}
