import { NextRequest, NextResponse } from "next/server";
import { authorizeAdminApi } from "@/lib/admin-auth";
import { isJsonRequest, readJsonWithLimit, RequestBodyTooLargeError } from "@/lib/request-body";
import { listReviewsForModeration, moderateReview } from "@/lib/reviews";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES = new Set(["pending", "published", "rejected", "all"]);

/** The moderation queue. Pending by default, because that is the job. */
export async function GET(request: NextRequest) {
  const access = await authorizeAdminApi(request);
  if (access.response) return access.response;

  const requested = request.nextUrl.searchParams.get("status") ?? "pending";
  const status = STATUSES.has(requested) ? (requested as "pending" | "published" | "rejected" | "all") : "pending";

  try {
    const items = await listReviewsForModeration(status);
    return NextResponse.json({ ok: true, status, items }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    logger.error("Failed to load the review queue", { error });
    return NextResponse.json({ ok: false, error: "Could not load reviews." }, { status: 500 });
  }
}

/**
 * Publish or reject one review.
 *
 * The decision is taken in `moderateReview` with a conditional update on
 * `status = 'pending'`, so two operators reviewing the same item cannot both
 * succeed, and the audit entry names the decision and the reason.
 */
export async function POST(request: NextRequest) {
  const access = await authorizeAdminApi(request);
  if (access.response) return access.response;

  if (!isJsonRequest(request)) {
    return NextResponse.json({ ok: false, error: "Expected JSON" }, { status: 415 });
  }

  let body: unknown;
  try {
    body = await readJsonWithLimit(request, 4_096);
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: "Invalid request body." },
      { status: error instanceof RequestBodyTooLargeError ? 413 : 400 },
    );
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ ok: false, error: "Invalid request body." }, { status: 400 });
  }

  const { reviewId, decision, note } = body as {
    reviewId?: unknown;
    decision?: unknown;
    note?: unknown;
  };

  if (typeof reviewId !== "string" || !UUID.test(reviewId)) {
    return NextResponse.json({ ok: false, error: "Invalid review." }, { status: 400 });
  }
  if (decision !== "publish" && decision !== "reject") {
    return NextResponse.json({ ok: false, error: "Decision must be publish or reject." }, { status: 400 });
  }
  if (note != null && (typeof note !== "string" || note.length > 500)) {
    return NextResponse.json({ ok: false, error: "Note must be at most 500 characters." }, { status: 400 });
  }

  try {
    const result = await moderateReview({
      reviewId,
      decision,
      note: typeof note === "string" && note.trim() ? note.trim() : null,
      actor: access.user,
    });

    if (!result.ok) {
      return NextResponse.json(
        {
          ok: false,
          error:
            result.reason === "already-moderated"
              ? "That review has already been decided."
              : "Review not found.",
        },
        { status: result.reason === "already-moderated" ? 409 : 404 },
      );
    }

    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    logger.error("Review moderation failed", { reviewId, error });
    return NextResponse.json({ ok: false, error: "Could not update the review." }, { status: 500 });
  }
}
