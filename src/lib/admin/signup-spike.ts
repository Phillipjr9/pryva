import "server-only";

import { and, gte, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import { users } from "@/db/schema";
import { sendAlert } from "@/lib/platform/alerts";
import { logger } from "@/lib/platform/logger";

/**
 * "Quietly, we are being signed up."
 *
 * A bot attack is rarely one event worth a page. It is a shape: forty accounts
 * from nowhere before anyone looks at a dashboard. The fraud queue records each
 * *suspicious* signup, but a script whose emails pass the risk heuristics is
 * never suspicious one row at a time — it is only suspicious in aggregate, and
 * nothing here counted aggregates.
 *
 * This is that count. It runs after an account is committed, asks how many
 * accounts have been created in the last hour, and — past the threshold, and no
 * more than once a day — posts one line to the existing operator webhook
 * (`ALERT_WEBHOOK_URL`, the same channel errors go to; `sendAlert` is already
 * throttled by message, so a sustained flood does not become a flood of alerts).
 *
 * The threshold is deliberately generous. Real growth can add a dozen accounts
 * in a good hour; a script adds them in a minute and keeps going. The alert is a
 * doorbell, not a brake: nothing is blocked here, because the limits that do
 * block are the ones that must stay cheap and predictable.
 */

/** Accounts in one hour that stop looking like growth. */
export const SIGNUP_SPIKE_THRESHOLD = 25;

/** One doorbell per day. A spike that lasts a week is still one message a day. */
const SPIKE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Set by the first alert in this process; the logging path is a best-effort addition to it. */
const lastSpikeAlert = new Map<string, number>();

/**
 * A count of confirmed, non-closed accounts created since `since`.
 *
 * Counted from the database rather than an in-process counter: a serverless
 * deployment runs several instances, and each one would otherwise only see its
 * own share of the attack and stay under the threshold.
 */
export async function accountsCreatedSince(since: Date): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(users)
    .where(and(gte(users.createdAt, since), isNull(users.deletedAt)));
  return Number(row?.count ?? 0);
}

/**
 * Record a signup and alert once if the last hour looks automated.
 *
 * Best effort in every direction: the account is already created, and a failure
 * to count or to post must never surface to the person who signed up or to the
 * route that created them.
 */
export async function noteSignupAndMaybeAlert(): Promise<void> {
  try {
    const since = new Date(Date.now() - 60 * 60 * 1000);
    const created = await accountsCreatedSince(since);
    if (created < SIGNUP_SPIKE_THRESHOLD) return;

    const now = Date.now();
    const previous = lastSpikeAlert.get("signup-spike");
    if (previous !== undefined && now - previous < SPIKE_WINDOW_MS) return;
    lastSpikeAlert.set("signup-spike", now);

    // No visitor data: a count, a window and a threshold. The addresses and the
    // hashed IPs stay in the console where an operator can act on them.
    await sendAlert("Signup spike: accounts created in the last hour are above the threshold", {
      window: "60m",
      threshold: SIGNUP_SPIKE_THRESHOLD,
      accounts: created,
    });
    logger.warn("Signup spike alert sent", { window: "60m", accounts: created });
  } catch (error) {
    logger.warn("Could not evaluate the signup spike threshold", {
      error: error instanceof Error ? error.message : "unknown",
    });
  }
}

/** Test seam: the cooldown is module state. */
export function resetSignupSpikeCooldown(): void {
  lastSpikeAlert.clear();
}

/** Exported for tests that need to reason about the window without waiting. */
export const SIGNUP_SPIKE_WINDOW_MS = SPIKE_WINDOW_MS;
