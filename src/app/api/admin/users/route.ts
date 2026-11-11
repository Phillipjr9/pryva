import { authorizeAdminApi } from "@/lib/identity/admin-auth";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { desc, count } from "drizzle-orm";
import { pageWindow } from "@/lib/platform/pagination";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const access = await authorizeAdminApi(request);
    if (access.response) return access.response;

    // Bounded: `?limit=` used to reach the database unchanged, so one request
    // could ask for every account at once. See `pageWindow`.
    const { limit, offset } = pageWindow(request.nextUrl.searchParams);

    // Only the columns this response sends. The unqualified read used to pull
    // every column of every listed account into memory — password hashes and
    // lockout state included — to return five of them.
    const allUsers = await db.query.users.findMany({
      columns: { id: true, name: true, email: true, walletBalance: true, createdAt: true },
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
