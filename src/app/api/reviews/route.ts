import { NextRequest, NextResponse } from "next/server";
import { requireAuthApi } from "@/lib/auth";
import { isSameOriginMutation } from "@/lib/net";
import { isJsonRequest, readJsonWithLimit, RequestBodyTooLargeError } from "@/lib/request-body";
import { reviewRateLimiter } from "@/lib/rate-limit";
import { createReview, normalizeReview } from "@/lib/reviews";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Write a review for one of your own delivered orders.
 *
 * The eligibility rules live in `src/lib/reviews.ts`, not here, so the dashboard,
 * this route and the tests all consult one implementation: ownership, a
 * delivered/completed status, no existing review, and a 1–5 rating with a body
 * between 20 and 1,200 characters. Every new review is pending until an operator
 * publishes it.
 */
export async function POST(request: NextRequest) {
  const user = await requireAuthApi();
  if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if (!isSameOriginMutation(request)) {
    return NextResponse.json({ ok: false, error: "Invalid origin" }, { status: 403 });
  }
  if (!isJsonRequest(request)) {
    return NextResponse.json({ ok: false, error: "Expected JSON" }, { status: 415 });
  }

  const limit = await reviewRateLimiter(`review:${user.id}`);
  if (limit.unavailable) {
    return NextResponse.json(
      { ok: false, error: "Reviews are temporarily unavailable. Please try again later." },
      { status: 503 },
    );
  }
  if (!limit.allowed) {
    return NextResponse.json(
      { ok: false, error: "Too many review attempts. Please try again later." },
      { status: 429 },
    );
  }

  let body: unknown;
  try {
    body = await readJsonWithLimit(request, 8_192);
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: "Invalid request body." },
      { status: error instanceof RequestBodyTooLargeError ? 413 : 400 },
    );
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }

  const { orderId } = body as { orderId?: unknown };
  if (typeof orderId !== "string" || !UUID.test(orderId)) {
    return NextResponse.json({ ok: false, error: "Invalid order." }, { status: 400 });
  }

  const normalized = normalizeReview(body);
  if (!normalized.ok) {
    const message =
      normalized.reason === "rating"
        ? "Choose a rating from 1 to 5."
        : normalized.reason === "headline"
          ? "Keep the headline under 80 characters."
          : "Write between 20 and 1,200 characters.";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }

  try {
    const result = await createReview({
      userId: user.id,
      orderId,
      rating: normalized.rating,
      headline: normalized.headline,
      body: normalized.body,
    });

    if (!result.ok) {
      const message =
        result.reason === "not-your-order"
          ? "That order is not one you can review."
          : result.reason === "not-delivered"
            ? "You can review an order once it has been delivered."
            : "This order already has a review.";
      return NextResponse.json(
        { ok: false, error: message },
        { status: result.reason === "not-your-order" ? 404 : 409 },
      );
    }

    return NextResponse.json(
      { ok: true, id: result.id, status: "pending" },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    logger.error("Review submission failed", { userId: user.id, error });
    return NextResponse.json(
      { ok: false, error: "Could not save the review. Please try again." },
      { status: 500 },
    );
  }
}
