import { createHash, randomInt } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { isPreviewDatabase } from "@/lib/platform/demo-policy";

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

function makeRoomInPreviewRateLimitStore() {
  cleanupRateLimitStore();
  if (previewStore.size < MAX_PREVIEW_KEYS) return;

  const oldestEntries = [...previewStore.entries()]
    .sort(([, left], [, right]) => left.resetTime - right.resetTime)
    .slice(0, previewStore.size - MAX_PREVIEW_KEYS + 1);

  for (const [key] of oldestEntries) previewStore.delete(key);
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
        if (!record) {
          makeRoomInPreviewRateLimitStore();
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
 * Reading the live catalogue is not a purchase.
 *
 * The hub re-reads it whenever the customer picks a country, and the read fans
 * out to three suppliers, so it needs its own budget: ten a minute (the purchase
 * bucket) throttled a customer browsing four countries and then pressing Retry,
 * and the throttled answer looked identical to a supplier outage.
 */
export const catalogRateLimiter = createRateLimiter({ windowMs: 60_000, maxRequests: 30 });
/**
 * Give one slot back.
 *
 * Rate limits here count *attempts*, which is right when an attempt is the thing
 * being protected against — but wrong when the attempt failed for a reason that
 * cost nothing. The free-inbox limiter is the case that exposed it: it allows
 * three creates per connection per day, and every failed attempt was burning one,
 * so a customer who pressed a broken button three times was then told to come back
 * tomorrow. That turns a bug into a lockout.
 *
 * Only ever decrements a live bucket, never below zero, and never extends a
 * window: this cannot be used to buy extra allowance, only to undo a slot that
 * was spent without the work happening. Callers must decide whether the failure
 * was costless — releasing after a request that may have spent money would let an
 * attacker retry a supplier call without limit.
 */
export async function releaseRateLimit(key: string): Promise<void> {
  const hashedKey = digest(key);
  if (isPreviewDatabase()) {
    const record = previewStore.get(hashedKey);
    if (record && Date.now() < record.resetTime) record.count = Math.max(0, record.count - 1);
    return;
  }
  try {
    await db.execute(sql`
      UPDATE rate_limit_buckets
      SET count = GREATEST(count - 1, 0)
      WHERE key = ${hashedKey} AND reset_at > now()
    `);
  } catch (error) {
    // Failing to give the slot back must never fail the request that already
    // failed. The customer simply keeps a limit they did not use.
    console.error(
      "Rate-limit release failed:",
      error instanceof Error ? error.message : error,
    );
  }
}

/**
 * The refusal for an authenticated read that hit its budget.
 *
 * Money paths build their own copy through `beginPurchase()`, because a refused
 * purchase has to explain itself to a paying customer. A refused list or search
 * is background traffic: it needs a `Retry-After` a polling client can honour
 * and a status a fetch loop will not mistake for success. `unavailable` is
 * reported as 503 rather than quietly allowed, matching every other caller —
 * a counter that cannot be read is not permission.
 */
export function rateLimitRefusal(
  result: RateLimitResult,
  message = "Too many requests. Please wait a moment and try again.",
): Response | null {
  if (!result.unavailable && result.allowed) return null;
  if (result.unavailable) {
    return Response.json(
      { ok: false, error: "This is temporarily unavailable. Please try again shortly." },
      { status: 503, headers: { "Retry-After": "30" } },
    );
  }
  return Response.json(
    { ok: false, error: message },
    {
      status: 429,
      headers: { "Retry-After": String(Math.max(1, Math.ceil((result.resetTime - Date.now()) / 1000))) },
    },
  );
}

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
 * Closing an account is destructive, authenticated by a password and bounded by a
 * fresh session, so three attempts in fifteen minutes is generous — a mistyped
 * address or password accounts for all of them. The limit exists because the
 * endpoint compares a password, which makes repeat attempts expensive.
 */
export const accountDeletionRateLimiter = createRateLimiter({ windowMs: 15 * 60_000, maxRequests: 3 });
/**
 * Notifications are polled rather than submitted, so this is sized to tolerate a
 * client refreshing on an interval without ever throttling a real user.
 */
export const notificationRateLimiter = createRateLimiter({ windowMs: 60_000, maxRequests: 30 });
export const giftCardUserRateLimiter = createRateLimiter({ windowMs: 15 * 60_000, maxRequests: 15 });
// Reviews are written once per order, so a handful per hour is generous; the cap
// exists to stop an automated account filling the moderation queue.
export const reviewRateLimiter = createRateLimiter({ windowMs: 60 * 60_000, maxRequests: 6 });
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
export const inboxCreateIpRateLimiter = createRateLimiter({ windowMs: 24 * 60 * 60_000, maxRequests: 50 });
/**
 * Polling an inbox re-reads the whole mailbox from the supplier, whose request
 * budget is shared across every customer at once. Without a per-user ceiling one
 * browser tab refreshing on an interval could consume the whole budget and turn
 * everybody else's purchases into 429s -- a denial of service that costs the
 * attacker nothing. Twelve a minute is far more than a human needs while waiting
 * for a verification code.
 */
export const inboxPollRateLimiter = createRateLimiter({ windowMs: 60_000, maxRequests: 12 });
/**
 * Support messages run the assistant, which reads the account and may call the
 * payment provider. Twenty in fifteen minutes is well past what a real
 * conversation needs and low enough that a script cannot use the assistant as a
 * free provider-probing service.
 */
export const supportMessageRateLimiter = createRateLimiter({ windowMs: 15 * 60_000, maxRequests: 20 });
/**
 * Passkey ceremonies. Each one is a round trip to an authenticator and, on the
 * sign-in path, a signature check; the limit is per IP because the sign-in
 * ceremony happens before anybody is known to be signed in.
 */
export const passkeyRateLimiter = createRateLimiter({ windowMs: 60_000, maxRequests: 12 });

/**
 * Google signup and sign-in return.
 *
 * This had no limit at all, and it is the one path that both mints an account
 * and emails the operator without any password, challenge or field the caller
 * has to get right. A script with enough verified Google identities — bought,
 * farmed, or its own — therefore never touched the turnstile-protected signup
 * route. Sized well above a person (who completes this flow maybe twice ever)
 * and per IP, because at this point in the flow nobody is known yet.
 */
export const oauthRateLimiter = createRateLimiter({ windowMs: 15 * 60_000, maxRequests: 20 });

/**
 * Creating a verification link is creating an outbound email.
 *
 * The signup route mints one per successful POST, so the signup IP limit bounds
 * this — but the resend endpoint mints one outside signup entirely, and every
 * message costs provider quota and sender reputation. An address a bot abandons
 * is still an address Resend has to deliver to.
 */
export const verificationSendRateLimiter = createRateLimiter({ windowMs: 60 * 60_000, maxRequests: 5 });

/**
 * Authenticated reads that join on user-owned tables (`ilike` scans, joins).
 *
 * These are not money paths, so they never needed `beginPurchase()`, but they
 * are the cheapest way for one stolen session to make the database do work:
 * a search box refetched on every keystroke, or the order list polled. The
 * budget is per account and generous enough that a fast-filtering dashboard
 * never notices it.
 */
export const accountReadRateLimiter = createRateLimiter({ windowMs: 60_000, maxRequests: 60 });

/** Drop one key's counter after successful authentication. */
export async function resetRateLimit(key: string): Promise<void> {
  const hashedKey = digest(key);
  if (isPreviewDatabase()) {
    previewStore.delete(hashedKey);
    return;
  }
  await db.execute(sql`DELETE FROM rate_limit_buckets WHERE key = ${hashedKey}`);
}
