import "server-only";

import { after } from "next/server";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { users } from "@/db/schema";
import { sendNewUserSignupAlert } from "@/lib/email/contact-message-email";
import { logger } from "@/lib/platform/logger";

/**
 * The operator's "a new customer joined" email — sent when an account becomes a
 * customer, not when a form is posted.
 *
 * This used to fire from `/api/auth/signup` on every successful POST, with
 * `status: "pending_verification"`. Any bot that could fill three fields
 * therefore caused an email to the owner's inbox, and the owner reasonably read
 * that pile as inbound spam. The accounts were mostly never verified; the mail
 * was real, automated, and self-inflicted.
 *
 * Now it is triggered by the two events that actually prove a person: clicking
 * the verification link, and signing up with a Google address Google has already
 * verified. Everything else stays quiet and visible in the admin console.
 *
 * Best effort throughout. The verification is already committed when this runs,
 * so a mail failure must never surface to the customer as a failed confirmation.
 */
export async function sendVerifiedSignupAlert(userId: string): Promise<boolean> {
  const [user] = await db
    .select({
      name: users.name,
      email: users.email,
      createdAt: users.createdAt,
      deletedAt: users.deletedAt,
      emailVerifiedAt: users.emailVerifiedAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  // A closed account is not news, and neither is one that somehow reaches here
  // unverified — that would reintroduce exactly the noise this module removes.
  if (!user || user.deletedAt || !user.emailVerifiedAt) return false;

  return sendNewUserSignupAlert({
    name: user.name,
    email: user.email,
    createdAt: user.createdAt,
    status: "verified",
  });
}

/**
 * Defer to `after()` so the customer's confirmation page never waits on the
 * owner's mail. Mirrors `scheduleOnboardingEmails`, including the no-request-
 * context case: a script or a directly invoked handler has no `after` hook, and
 * an operator notification is not worth awaiting inline.
 */
export function scheduleVerifiedSignupAlert(userId: string): void {
  try {
    after(async () => {
      try {
        await sendVerifiedSignupAlert(userId);
      } catch (error) {
        logger.warn("New signup alert failed after the response", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
  } catch {
    logger.warn("New signup alert skipped: no request context for `after`", {});
  }
}
