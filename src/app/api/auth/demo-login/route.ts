import { NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { createSession, hashPassword } from "@/lib/auth";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * POST /api/auth/demo-login
 * One-click demo login for testing and demonstration
 */
export async function POST() {
  try {
    // Demo user credentials
    const demoEmail = "demo@pryva.ng";
    const demoPassword = "demo123";
    const demoName = "Demo User";

    // Check if demo user exists
    let [demoUser] = await db
      .select()
      .from(users)
      .where(eq(users.email, demoEmail))
      .limit(1);

    // Create demo user if doesn't exist
    if (!demoUser) {
      const passwordHash = await hashPassword(demoPassword);

      [demoUser] = await db
        .insert(users)
        .values({
          name: demoName,
          email: demoEmail,
          passwordHash,
          walletBalance: 50000, // Start with ₦50,000 for testing
        })
        .returning();

      logger.info("Demo user created", { userId: demoUser.id });
    }

    // Create session — createSession() sets the correct httpOnly cookie
    // (`pryva_session`, the name every reader uses).
    await createSession(demoUser.id);

    logger.info("Demo login successful", { userId: demoUser.id });

    return NextResponse.json({
      ok: true,
      user: {
        id: demoUser.id,
        name: demoUser.name,
        email: demoUser.email,
        walletBalance: demoUser.walletBalance,
      },
      message: "Demo login successful",
    });
  } catch (error) {
    logger.error("Demo login failed:", { error });
    return NextResponse.json(
      { error: "Demo login failed" },
      { status: 500 }
    );
  }
}
