import { eq } from "drizzle-orm";
import { db, hasDatabase } from "@/db";
import { users } from "@/db/schema";
import { hashPassword } from "@/lib/auth";
import { creditWallet } from "@/lib/wallet";
import {
  DEMO_EMAIL,
  DEMO_PASSWORD,
  DEMO_STARTING_BALANCE,
  DEMO_USER,
} from "@/lib/demo-account";

const DEMO_MIN_BALANCE = 5000;

/** Finds or creates the shared demo account, or opens a static preview account. */
export async function openDemoAccount() {
  if (!hasDatabase) return DEMO_USER;

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
