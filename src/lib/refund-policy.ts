/**
 * Refund eligibility for number orders that never delivered a code.
 *
 * Deliberately provider-agnostic. What the customer is owed does not depend on
 * who fulfilled the order, and gating this on `provider === "simulated"` is what
 * previously left paid-but-undelivered live orders with no refund path at all —
 * neither the automatic sweep nor self-service would touch them.
 *
 * Rentals are excluded by construction rather than by an explicit check: they
 * carry a different `duration`, and no upstream cancel exists for them, so a
 * rental that under-delivers must be reconciled by a human who can weigh the
 * time already used against the price paid.
 */
export const SINGLE_NUMBER_WINDOW = "Single verification · 20 min window";

/** A single-verification number order that produced no code. */
export function isUndeliveredSingleNumber(order: {
  service: string;
  duration: string;
  otpCode: string | null;
}): boolean {
  return (
    order.service === "numbers" &&
    order.duration === SINGLE_NUMBER_WINDOW &&
    order.otpCode == null
  );
}
