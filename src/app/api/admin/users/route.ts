import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users, orders } from "@/db/schema";
import { desc, count } from "drizzle-orm";
import { requireAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // TODO: Add admin role check here

    const limit = parseInt(request.nextUrl.searchParams.get("limit") || "50");
    const offset = parseInt(request.nextUrl.searchParams.get("offset") || "0");

    const allUsers = await db.query.users.findMany({
      orderBy: [desc(users.createdAt)],
      limit,
      offset,
    });

    const [total] = await db.select({ count: count() }).from(users);

    return NextResponse.json({
      ok: true,
      users: allUsers.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        walletBalance: u.walletBalance,
        createdAt: u.createdAt.toISOString(),
      })),
      total: total?.count || 0,
      limit,
      offset,
    });
  } catch (error) {
    console.error("Failed to fetch users:", error);
    return NextResponse.json({ error: "Failed to fetch users" }, { status: 500 });
  }
}
