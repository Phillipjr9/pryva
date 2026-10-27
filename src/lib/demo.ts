import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { hashPassword } from "@/lib/auth";
import { creditWallet } from "@/lib/wallet";
import { DEMO_EMAIL, isPreviewDatabase } from "@/lib/demo-policy";
const DEMO_PASSWORD = "pryva-demo-2026";
export const DEMO_STARTING_BALANCE = 25000;
const DEMO_MIN_BALANCE = 5000;

/** Finds or creates the shared demo account and keeps it topped up. */
export async function openDemoAccount() {
  if (!isPreviewDatabase()) return null;

  let [user] = await db.select().from(users).where(eq(users.email, DEMO_EMAIL)).limit(1);

  if (!user) {
    try {
      const [created] = await db
        .insert(users)
        .values({
          name: "Ada Demo",
          email: DEMO_EMAIL,
          passwordHash: hashPassword(DEMO_PASSWORD),
          walletBalance: DEMO_STARTING_BALANCE,
        })
        .returning();
      user = created;
    } catch {
      // Concurrent demo sign-ins can race on the unique email — re-read.
      [user] = await db.select().from(users).where(eq(users.email, DEMO_EMAIL)).limit(1);
    }
  }

  if (user && user.walletBalance < DEMO_MIN_BALANCE) {
    await creditWallet({
      userId: user.id,
      amount: 20000,
      type: "credit",
      description: "Demo wallet refresh",
    });
  }

  return user ?? null;
}
