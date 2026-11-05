import "server-only";
import type { db } from "@/db";
import { sql } from "drizzle-orm";
import { walletEmailOutbox } from "@/db/schema";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Queue inside the password/session transaction. This is explicit rather than a
 * database trigger: while a new release builds, the old settings route still
 * sends its own direct notice, and a trigger would produce a second one.
 */
export async function queuePasswordChangeEmail(
  tx: Transaction,
  user: { id: string; name: string; email: string },
): Promise<void> {
  await tx.insert(walletEmailOutbox).values({
    userId: user.id,
    recipient: user.email,
    recipientName: user.name,
    eventKind: "password_changed",
    // Old workers ignore new kinds during the build; the new worker uses this
    // separate due time, including for retries.
    availableAt: sql`now() + interval '10 years'`,
    notificationDueAt: sql`now()`,
  });
}
