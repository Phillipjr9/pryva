import { NextResponse } from "next/server";
import { db } from "@/db";
import { users, sessions } from "@/db/schema";
import { eq } from "drizzle-orm";
import { hashPassword } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { cookies } from "next/headers";

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

    // Create session
    const sessionToken = `demo_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days

    await db.insert(sessions).values({
      userId: demoUser.id,
      token: sessionToken,
      expiresAt,
    });

    // Set session cookie
    cookies().set("session", sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 7, // 7 days
      path: "/",
    });

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
