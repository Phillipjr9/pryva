import "server-only";

import { purchaseVelocity, recordFraudEvent } from "@/lib/admin/fraud";
import { settleReferralRewards } from "@/lib/content/referrals";
import { scheduleWalletEmails } from "@/lib/email/schedule-wallet-emails";
import { requireAuthApi, type PublicUser } from "@/lib/identity/auth";
import { financialActionsUnavailable } from "@/lib/platform/financial-environment";
import { logger } from "@/lib/platform/logger";
import { isSameOriginMutation } from "@/lib/platform/net";
import { purchaseRateLimiter } from "@/lib/platform/rate-limit";
import { isJsonRequest, readJsonWithLimit, RequestBodyTooLargeError } from "@/lib/platform/request-body";

/**
 * The gate every money path walks through.
 *
 * Six purchase routes each re-implemented the same prologue — authenticate,
 * check the origin, check the content type, check the financial environment,
 * rate-limit, check velocity, parse a bounded body — in five different orders and
 * with different answers. The drift was not hypothetical: referral settlement ran
 * on two of the six, the velocity ceiling on three, and an unauthenticated caller
 * got `{error}` from one route and `{ok:false,error}` from the next.
 *
 * This module owns the *order* of the gates, so a failure always reports the same
 * thing, and a route only supplies what is genuinely route-specific: the copy for
 * its own product, and any supplier gate beyond the financial one.
 *
 * What stays in the route: price resolution, the supplier call, the transaction,
 * the refund/release path. Those differ per product because the products differ.
 */

export type CheckoutCopy = {
  unauthorized: string;
  unavailable: string;
  limiterDown: string;
  /** A string, or the remaining window so a route can say how long to wait. */
  rateLimited: string | ((retryAfterMs: number) => string);
  tooFast: string;
  bodyTooLarge: string;
  invalidBody: string;
};

/** The default wording. A route overrides only where its product needs to. */
const DEFAULT_COPY: CheckoutCopy = {
  unauthorized: "Please sign in to complete this order.",
  unavailable: "Purchases are unavailable in this environment.",
  limiterDown: "Purchases are temporarily unavailable.",
  rateLimited: "Too many attempts. Try again later.",
  tooFast: "That is a lot of orders in a short time. Please try again in a few minutes.",
  bodyTooLarge: "That request is too large.",
  invalidBody: "Invalid request body.",
};

export type BeginOptions = {
  /** Rate-limit bucket. Must be unique per purchase path. */
  bucket: string;
  copy?: Partial<CheckoutCopy>;
  /** Ceiling on the request body. Every path reads JSON, so this always applies. */
  maxBodyBytes?: number;
  /**
   * A supplier gate beyond the environment one — "the marketplace is not wired",
   * "the voucher feed has no key". Runs after the financial gate and before the
   * limiter, so a closed product costs no database work.
   */
  supplierGate?: { open: () => boolean; message: string };
  /**
   * Count purchases in the last hour. On by default: this is the only check that
   * survives across instances, and a purchase path that forgets it is how an
   * account script becomes unbounded. A read failure allows the purchase.
   */
  velocity?: boolean;
};

export type Begun<T> =
  | { ok: true; user: PublicUser; body: T }
  | { ok: false; response: Response };

function refuse(message: string, status: number): { ok: false; response: Response } {
  return { ok: false, response: Response.json({ ok: false, error: message }, { status }) };
}

/**
 * Run the shared gates and return the caller, the parsed body, or the refusal.
 *
 * Order is deliberate:
 *   1. identity      — never do work for an anonymous caller
 *   2. origin        — a cross-site POST must not reach a money path at all
 *   3. content type  — a form post is not our client
 *   4. environment   — the preview database must not move money
 *   5. supplier      — a product with no credential refuses before any read
 *   6. rate limit    — the burst guard
 *   7. velocity      — the paced-script guard
 *   8. body          — parsing last, because everything above can refuse without it
 */
export async function beginPurchase<T = Record<string, unknown>>(
  request: Request,
  options: BeginOptions,
): Promise<Begun<T>> {
  const copy = { ...DEFAULT_COPY, ...options.copy };

  const user = await requireAuthApi();
  if (!user) return refuse(copy.unauthorized, 401);

  if (!isSameOriginMutation(request)) return refuse("Cross-origin request denied.", 403);

  if (!isJsonRequest(request)) return refuse("Expected JSON.", 415);

  if (financialActionsUnavailable()) return refuse(copy.unavailable, 503);

  if (options.supplierGate && !options.supplierGate.open()) {
    return refuse(options.supplierGate.message, 503);
  }

  const limit = await purchaseRateLimiter(`${options.bucket}:${user.id}`);
  if (limit.unavailable) return refuse(copy.limiterDown, 503);
  if (!limit.allowed) {
    const message =
      typeof copy.rateLimited === "function"
        ? copy.rateLimited(Math.max(0, limit.resetTime - Date.now()))
        : copy.rateLimited;
    return refuse(message, 429);
  }

  if (options.velocity !== false) {
    const velocity = await purchaseVelocity(user.id).catch(() => ({ allowed: true, count: 0, limit: 0 }));
    if (!velocity.allowed) {
      // Best effort: the ceiling has already refused the purchase. Failing to
      // record why must not turn a 429 into a 500.
      try {
        await recordFraudEvent({
          userId: user.id,
          kind: "purchase_velocity",
          severity: "warn",
          reasons: [`${velocity.count} orders in the last hour (limit ${velocity.limit})`],
        });
      } catch {
        // ignored on purpose
      }
      return refuse(copy.tooFast, 429);
    }
  }

  let body: unknown;
  try {
    body = await readJsonWithLimit(request, options.maxBodyBytes ?? 4_096);
  } catch (error) {
    return error instanceof RequestBodyTooLargeError
      ? refuse(copy.bodyTooLarge, 413)
      : refuse(copy.invalidBody, 400);
  }

  return { ok: true, user, body: body as T };
}

/**
 * Work that follows a completed purchase, for every product.
 *
 * Both steps are best-effort by design: a referral credit or a queued receipt
 * must never turn a customer's successful order into an error, and both are
 * idempotent, so running them on every path is safe. They ran on two of the six
 * routes before, which meant a customer invited by a friend who bought accounts
 * or a boost never triggered the reward.
 */
export async function afterPurchase(userId: string): Promise<void> {
  scheduleWalletEmails();
  await settleReferralRewards({ refereeId: userId }).catch((error) => {
    logger.warn("Referral settlement failed after a purchase", {
      message: error instanceof Error ? error.message : String(error),
    });
  });
}
