import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireAuthApi } from "@/lib/auth";
import { isSameOriginMutation } from "@/lib/net";
import { isJsonRequest, readJsonWithLimit, RequestBodyTooLargeError } from "@/lib/request-body";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await requireAuthApi();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userProfile = await db.query.users.findFirst({
      where: eq(users.id, user.id),
    });

    if (!userProfile) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    return NextResponse.json({
      ok: true,
      user: {
        id: userProfile.id,
        name: userProfile.name,
        email: userProfile.email,
        walletBalance: userProfile.walletBalance,
        createdAt: userProfile.createdAt.toISOString(),
      },
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("Failed to fetch profile:", error);
    return NextResponse.json({ error: "Failed to fetch profile" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const user = await requireAuthApi();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
    if (!isJsonRequest(request)) return NextResponse.json({ error: "Expected JSON" }, { status: 415 });
    let body: unknown;
    try {
      body = await readJsonWithLimit(request, 2_048);
    } catch (error) {
      return NextResponse.json({ error: "Invalid request" }, { status: error instanceof RequestBodyTooLargeError ? 413 : 400 });
    }
    const name = body && typeof body === "object" && !Array.isArray(body) ? (body as { name?: unknown }).name : null;

    if (typeof name !== "string" || name.trim().length < 2 || name.trim().length > 120) {
      return NextResponse.json({ error: "Invalid name" }, { status: 400 });
    }

    await db
      .update(users)
      .set({ name: name.trim() })
      .where(eq(users.id, user.id));

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Failed to update profile:", error);
    return NextResponse.json({ error: "Failed to update profile" }, { status: 500 });
  }
}
