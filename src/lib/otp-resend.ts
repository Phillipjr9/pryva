import "server-only";

import { BitcallError, isBitcallConfigured, resendBitcallOtpActivation } from "@/lib/bitcall";

/**
 * Asking for a code again.
 *
 * A verification window is twenty minutes. Without this, a code that never
 * arrived — or arrived while the customer was on another screen — ended in a
 * refund, which costs the sale *and* the number we already paid for. A resend
 * re-delivers from the same rental, so it is the cheapest possible resolution.
 *
 * Deliberately narrow: the feature exists on one supplier, and reactivation is
 * **not** exposed. Reactivation re-opens an expired rental, which is a fresh
 * charge we would be making without charging the customer — a margin hole, not a
 * convenience. The refusal path is honest: a cooldown says "wait", anything else
 * says "try again", and neither pretends the code was sent.
 */

export type ResendTarget = {
  service: string;
  provider: string | null;
  status: string;
  refundedAt: Date | null;
  providerRequestId: string | null;
};

/**
 * Whether the order screen should offer the button at all. Computed on the server
 * so the browser receives a boolean, never a supplier name.
 */
export function canResendNumberCode(order: ResendTarget): boolean {
  return (
    order.service === "numbers" &&
    order.provider === "bitcall" &&
    order.status === "active" &&
    !order.refundedAt &&
    Boolean(order.providerRequestId) &&
    isBitcallConfigured()
  );
}

export type ResendResult =
  | { ok: true }
  | { ok: false; error: string; status: number };

export async function resendNumberCode(order: ResendTarget): Promise<ResendResult> {
  if (!order.providerRequestId) {
    return { ok: false, error: "This order has no active number to resend to.", status: 409 };
  }

  try {
    await resendBitcallOtpActivation(order.providerRequestId);
    return { ok: true };
  } catch (error) {
    const code = error instanceof BitcallError ? error.code : null;
    // The supplier throttles resends on a short timer of its own. Nothing was
    // charged and nothing was sent, so "wait a moment" is the true answer.
    if (code === "RATE_LIMITED" || code === "CANCELLATION_NOT_AVAILABLE_YET") {
      return { ok: false, error: "Give it a minute, then try again.", status: 429 };
    }
    if (code === "SERVICE_UNAVAILABLE" || code === "INTERNAL_ERROR" || code === "SERVICE_RESPONSE_INVALID") {
      return { ok: false, error: "The code couldn't be sent again just now. Try in a moment.", status: 502 };
    }
    return { ok: false, error: "This number can no longer receive codes. Contact support with your reference.", status: 409 };
  }
}
