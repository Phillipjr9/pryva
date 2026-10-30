import { createHash, randomInt } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { isPreviewDatabase } from "@/lib/demo-policy";

interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
}

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetTime: number;
  /** The shared store failed; callers must fail closed with a 503. */
  unavailable?: boolean;
};

const previewStore = new Map<string, { count: number; resetTime: number }>();
const MAX_PREVIEW_KEYS = 10_000;

function digest(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function cleanupRateLimitStore() {
  const now = Date.now();
  for (const [key, record] of previewStore) {
    if (now >= record.resetTime) previewStore.delete(key);
  }
}

/**
 * PostgreSQL uses one atomic upsert per bucket, shared by every app instance.
 * Preview mode is intentionally process-local and is not a production store.
 * Store failures must not silently fall back to per-instance counters.
 */
export function createRateLimiter(config: RateLimitConfig) {
  if (!Number.isSafeInteger(config.windowMs) || config.windowMs < 1 ||
      !Number.isSafeInteger(config.maxRequests) || config.maxRequests < 1 || config.maxRequests >= 2_147_483_647) {
    throw new Error("Invalid rate-limit configuration");
  }

  return async function rateLimit(key: string): Promise<RateLimitResult> {
    const hashedKey = digest(key);
    const now = Date.now();
    if (isPreviewDatabase()) {
      const record = previewStore.get(hashedKey);
      if (!record || now >= record.resetTime) {
        if (!record && previewStore.size >= MAX_PREVIEW_KEYS) {
          cleanupRateLimitStore();
          if (previewStore.size >= MAX_PREVIEW_KEYS) {
            return { allowed: false, remaining: 0, resetTime: now + config.windowMs, unavailable: true };
          }
        }
        const resetTime = now + config.windowMs;
        previewStore.set(hashedKey, { count: 1, resetTime });
        return { allowed: true, remaining: config.maxRequests - 1, resetTime };
      }
      record.count = Math.min(record.count + 1, config.maxRequests + 1);
      return { allowed: record.count <= config.maxRequests, remaining: Math.max(0, config.maxRequests - record.count), resetTime: record.resetTime };
    }

    try {
      // The row lock acquired by ON CONFLICT makes the count update atomic
      // across separate PostgreSQL connections and application instances.
      const result = await db.execute(sql`
        INSERT INTO rate_limit_buckets (key, count, reset_at)
        VALUES (${hashedKey}, 1, now() + ${config.windowMs} * interval '1 millisecond')
        ON CONFLICT (key) DO UPDATE SET
          count = CASE WHEN rate_limit_buckets.reset_at <= now() THEN 1
            ELSE LEAST(rate_limit_buckets.count + 1, ${config.maxRequests + 1}) END,
          reset_at = CASE WHEN rate_limit_buckets.reset_at <= now()
            THEN now() + ${config.windowMs} * interval '1 millisecond'
            ELSE rate_limit_buckets.reset_at END
        RETURNING count, reset_at
      `);
      const rows = (result as unknown as { rows: { count: number; reset_at: Date | string }[] }).rows;
      const count = rows[0]?.count;
      const resetTime = new Date(rows[0]?.reset_at).getTime();
      if (!Number.isInteger(count) || !Number.isFinite(resetTime)) throw new Error("Invalid rate-limit result");

      // Bound stale-row growth without a permanently running worker. This
      // indexed cleanup is independent of the request's allow/deny decision.
      if (randomInt(1000) === 0) {
        try {
          await db.execute(sql`DELETE FROM rate_limit_buckets WHERE reset_at < now() - interval '1 day'`);
        } catch (error) {
          console.error(
            "Rate-limit cleanup failed:",
            error instanceof Error ? error.message : error,
          );
        }
      }
      return { allowed: count <= config.maxRequests, remaining: Math.max(0, config.maxRequests - count), resetTime };
    } catch (error) {
      // The cause used to be discarded here, so the log held a single line and a
      // missing table was indistinguishable from a dead connection or a refused
      // IAM token. Failing closed is the right decision; the silence was not.
      console.error(
        "Shared rate-limit store unavailable:",
        error instanceof Error ? error.message : error,
      );
      return { allowed: false, remaining: 0, resetTime: now + config.windowMs, unavailable: true };
    }
  };
}

export const apiRateLimiter = createRateLimiter({ windowMs: 60_000, maxRequests: 60 });
export const demoRateLimiter = createRateLimiter({ windowMs: 60_000, maxRequests: 30 });
export const authRateLimiter = createRateLimiter({ windowMs: 15 * 60_000, maxRequests: 5 });
export const purchaseRateLimiter = createRateLimiter({ windowMs: 60_000, maxRequests: 10 });
/**
 * Refunds are the one customer action that both calls a provider and credits a
 * wallet, so it is throttled per account rather than per minute: ten genuine
 * refund requests in fifteen minutes is already unusual, and the eligibility
 * window means a legitimate retry never needs more.
 */
export const refundRateLimiter = createRateLimiter({ windowMs: 15 * 60_000, maxRequests: 10 });
export const securityReportRateLimiter = createRateLimiter({ windowMs: 60_000, maxRequests: 6 });
export const userExportRateLimiter = createRateLimiter({ windowMs: 60_000, maxRequests: 2 });
export const contactRateLimiter = createRateLimiter({ windowMs: 15 * 60_000, maxRequests: 5 });
/**
 * Changing a password requires the current one, so every attempt runs a scrypt
 * verification. That makes the endpoint an expensive oracle -- not for guessing
 * the new password, but for grinding the old one -- and five attempts per fifteen
 * minutes is far more than a human who mistypes needs.
 */
export const passwordChangeRateLimiter = createRateLimiter({ windowMs: 15 * 60_000, maxRequests: 5 });
/**
 * Notifications are polled rather than submitted, so this is sized to tolerate a
 * client refreshing on an interval without ever throttling a real user.
 */
export const notificationRateLimiter = createRateLimiter({ windowMs: 60_000, maxRequests: 30 });
export const giftCardUserRateLimiter = createRateLimiter({ windowMs: 15 * 60_000, maxRequests: 15 });
export const giftCardIpRateLimiter = createRateLimiter({ windowMs: 15 * 60_000, maxRequests: 60 });

/**
 * Creating a free inbox spends real money with the supplier the moment it is
 * bought, so this is a cost control and not merely an abuse control.
 *
 * It is keyed by IP rather than by account because the account half of the
 * defence is currently hollow: transactional email is not configured, so signup
 * never verifies an address and "signed-in users only" bounds nothing. Anyone can
 * register a hundred accounts. The per-user daily cap lives in the database (a
 * partial unique index on `disposable_inboxes.daily_key`); this is the per-IP
 * ceiling underneath it, sized to tolerate a household or a shared carrier NAT
 * while making bulk account farming unprofitable.
 */
export const inboxCreateIpRateLimiter = createRateLimiter({ windowMs: 24 * 60 * 60_000, maxRequests: 3 });
/**
 * Polling an inbox re-reads the whole mailbox from the supplier, whose request
 * budget is shared across every customer at once. Without a per-user ceiling one
 * browser tab refreshing on an interval could consume the whole budget and turn
 * everybody else's purchases into 429s -- a denial of service that costs the
 * attacker nothing. Twelve a minute is far more than a human needs while waiting
 * for a verification code.
 */
export const inboxPollRateLimiter = createRateLimiter({ windowMs: 60_000, maxRequests: 12 });

/** Drop one key's counter after successful authentication. */
export async function resetRateLimit(key: string): Promise<void> {
  const hashedKey = digest(key);
  if (isPreviewDatabase()) {
    previewStore.delete(hashedKey);
    return;
  }
  await db.execute(sql`DELETE FROM rate_limit_buckets WHERE key = ${hashedKey}`);
}
