import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { contactMessages } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { isSameOriginMutation } from "@/lib/net";
import { clientIp } from "@/lib/auth-rate-limit";
import { contactRateLimiter } from "@/lib/rate-limit";
import { isJsonRequest, readJsonWithLimit, RequestBodyTooLargeError } from "@/lib/request-body";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    if (!isSameOriginMutation(request)) return NextResponse.json({ error: "Cross-origin request denied" }, { status: 403 });
    if (!isJsonRequest(request)) return NextResponse.json({ error: "Expected JSON" }, { status: 415 });
    const limit = await contactRateLimiter(`contact:ip:${clientIp(request)}`);
    if (limit.unavailable) return NextResponse.json({ error: "Support requests are temporarily unavailable." }, { status: 503 });
    if (!limit.allowed) return NextResponse.json({ error: "Too many messages. Please try again later." }, { status: 429 });
    let body: unknown;
    try {
      body = await readJsonWithLimit(request, 65_536);
    } catch (error) {
      return NextResponse.json({ error: "Invalid message" }, { status: error instanceof RequestBodyTooLargeError ? 413 : 400 });
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Invalid message" }, { status: 400 });
    const { name, email, topic, message } = body as { name?: unknown; email?: unknown; topic?: unknown; message?: unknown };

    if (!name || !email || !topic || !message) {
      return NextResponse.json({ error: "All fields are required" }, { status: 400 });
    }

    if (typeof name !== "string" || name.trim().length < 2 || name.trim().length > 120) {
      return NextResponse.json({ error: "Invalid name" }, { status: 400 });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (typeof email !== "string" || email.trim().length > 200 || !emailRegex.test(email.trim())) {
      return NextResponse.json({ error: "Invalid email address" }, { status: 400 });
    }

    if (typeof topic !== "string" || !topic.trim() || topic.trim().length > 80) {
      return NextResponse.json({ error: "Invalid topic" }, { status: 400 });
    }
    if (typeof message !== "string" || message.trim().length < 10 || message.length > 10000) {
      return NextResponse.json({ error: "Message must be between 10 and 10,000 characters" }, { status: 400 });
    }

    const user = await getCurrentUser();
    await db.insert(contactMessages).values({
      userId: user?.id ?? null,
      name: name.trim(),
      email: email.trim().toLowerCase(),
      topic: topic.trim(),
      message: message.trim(),
      status: "open",
    });

    return NextResponse.json({ ok: true });
  } catch {
    console.error("Failed to submit contact form");
    return NextResponse.json({ error: "Failed to submit message" }, { status: 500 });
  }
}
