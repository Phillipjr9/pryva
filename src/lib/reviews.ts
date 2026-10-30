import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { orders, productReviews, users } from "@/db/schema";
import { recordAdminAction } from "@/lib/admin-audit";
import type { PublicUser } from "@/lib/auth";
import { logger } from "@/lib/logger";

/**
 * Reviews, and the three things they must never become.
 *
 * ## Not invented
 *
 * There is no seed data, no import, no "example" review and nothing generated.
 * A review exists only because an account that bought an order wrote it. When
 * there are none, the public page says so instead of showing something.
 *
 * ## Not anonymous to us, not identifying to strangers
 *
 * The public list deliberately returns **no customer identity at all** — not a
 * name, not an initial, not a masked email. A wallet is a financial account; a
 * review is not a reason to publish who holds one. Operators see the account in
 * the moderation queue because they have to judge the review in context.
 *
 * ## Not public until a human says so
 *
 * Every review starts `pending`. Publishing or rejecting is an admin action with
 * an audit row, and the update is conditional on the review still being pending,
 * so two operators cannot both decide it and have the last write silently win.
 */

export const REVIEW_BODY_MIN = 20;
export const REVIEW_BODY_MAX = 1200;
export const REVIEW_HEADLINE_MAX = 80;
export const REVIEW_RATINGS = [1, 2, 3, 4, 5] as const;

/**
 * Delivered and completed only. A refunded, cancelled, processing or failed
 * order is not a purchase the customer received, so it cannot be reviewed —
 * otherwise a refund would still leave a one-star record attached to the order.
 */
export const REVIEWABLE_STATUSES = ["delivered", "completed"] as const;

export type NormalizedReview =
  | { ok: true; rating: number; headline: string | null; body: string }
  | { ok: false; reason: "rating" | "headline" | "body" };

/** Validate a review from an untrusted body. Trims before measuring. */
export function normalizeReview(input: unknown): NormalizedReview {
  const fields =
    input && typeof input === "object" && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};

  const rating = fields.rating;
  if (typeof rating !== "number" || !Number.isInteger(rating) || !REVIEW_RATINGS.includes(rating as 1)) {
    return { ok: false, reason: "rating" };
  }

  const rawBody = typeof fields.body === "string" ? fields.body.trim().replace(/\r\n/g, "\n") : "";
  if (rawBody.length < REVIEW_BODY_MIN || rawBody.length > REVIEW_BODY_MAX) {
    return { ok: false, reason: "body" };
  }

  const rawHeadline = typeof fields.headline === "string" ? fields.headline.trim() : "";
  if (rawHeadline.length > REVIEW_HEADLINE_MAX) return { ok: false, reason: "headline" };

  return { ok: true, rating, headline: rawHeadline || null, body: rawBody };
}

export type CreateReviewResult =
  | { ok: true; id: string }
  | { ok: false; reason: "not-your-order" | "not-delivered" | "already-reviewed" };

/**
 * Write a review for one of the caller's own orders.
 *
 * Ownership is part of the lookup, not a check after it: an order belonging to
 * somebody else is indistinguishable from one that does not exist, so the
 * caller cannot probe for other people's references.
 */
export async function createReview(params: {
  userId: string;
  orderId: string;
  rating: number;
  headline: string | null;
  body: string;
}): Promise<CreateReviewResult> {
  const [order] = await db
    .select({
      id: orders.id,
      userId: orders.userId,
      status: orders.status,
      service: orders.service,
      productName: orders.productName,
    })
    .from(orders)
    .where(and(eq(orders.id, params.orderId), eq(orders.userId, params.userId)))
    .limit(1);

  if (!order) return { ok: false, reason: "not-your-order" };
  if (!(REVIEWABLE_STATUSES as readonly string[]).includes(order.status)) {
    return { ok: false, reason: "not-delivered" };
  }

  const [existing] = await db
    .select({ id: productReviews.id })
    .from(productReviews)
    .where(eq(productReviews.orderId, order.id))
    .limit(1);
  if (existing) return { ok: false, reason: "already-reviewed" };

  try {
    const [row] = await db
      .insert(productReviews)
      .values({
        userId: params.userId,
        orderId: order.id,
        service: order.service,
        productName: order.productName,
        rating: params.rating,
        headline: params.headline,
        body: params.body,
        status: "pending",
        moderatorNote: null,
        moderatedBy: null,
        moderatedAt: null,
        publishedAt: null,
      })
      .returning({ id: productReviews.id });
    if (!row) return { ok: false, reason: "already-reviewed" };
    return { ok: true, id: row.id };
  } catch (error) {
    // The unique index on order_id is the real guard: two concurrent submissions
    // both passed the check above, and exactly one of them can win here.
    logger.error("Review insert rejected", { orderId: order.id, userId: params.userId, error });
    return { ok: false, reason: "already-reviewed" };
  }
}

export type PublicReview = {
  id: string;
  service: string;
  productName: string;
  rating: number;
  headline: string | null;
  body: string;
  publishedAt: Date | null;
};

/** Published reviews only, newest first. Carries no customer identity. */
export async function listPublishedReviews(limit = 30): Promise<PublicReview[]> {
  const rows = await db
    .select({
      id: productReviews.id,
      service: productReviews.service,
      productName: productReviews.productName,
      rating: productReviews.rating,
      headline: productReviews.headline,
      body: productReviews.body,
      publishedAt: productReviews.publishedAt,
    })
    .from(productReviews)
    .where(eq(productReviews.status, "published"))
    .orderBy(desc(productReviews.publishedAt))
    .limit(Math.min(Math.max(limit, 1), 100));
  return rows;
}

/** The caller's own reviews, including pending and rejected ones. */
export async function listUserReviews(userId: string) {
  return db
    .select()
    .from(productReviews)
    .where(eq(productReviews.userId, userId))
    .orderBy(desc(productReviews.createdAt));
}

/** The caller's orders that can be reviewed and have not been yet. */
export async function listReviewableOrders(userId: string) {
  const ownOrders = await db
    .select({
      id: orders.id,
      reference: orders.reference,
      service: orders.service,
      productName: orders.productName,
      planLabel: orders.planLabel,
      status: orders.status,
      createdAt: orders.createdAt,
    })
    .from(orders)
    .where(eq(orders.userId, userId))
    .orderBy(desc(orders.createdAt));

  const reviewed = await db
    .select({ orderId: productReviews.orderId })
    .from(productReviews)
    .where(eq(productReviews.userId, userId));
  const reviewedIds = new Set(reviewed.map((row) => row.orderId));

  return ownOrders.filter(
    (order) =>
      (REVIEWABLE_STATUSES as readonly string[]).includes(order.status) &&
      !reviewedIds.has(order.id),
  );
}

export type ModerationDecision = "publish" | "reject";

/**
 * Publish or reject a pending review. Records who decided and why.
 *
 * The note is shown to the customer on a rejection, so it is written for them
 * ("contains a phone number") rather than for the moderator's own notes.
 */
export async function moderateReview(params: {
  reviewId: string;
  decision: ModerationDecision;
  note: string | null;
  actor: Pick<PublicUser, "id" | "email">;
}): Promise<{ ok: true } | { ok: false; reason: "not-found" | "already-moderated" }> {
  const now = new Date();
  const [updated] = await db
    .update(productReviews)
    .set({
      status: params.decision === "publish" ? "published" : "rejected",
      moderatorNote: params.note ? params.note.slice(0, 500) : null,
      moderatedBy: params.actor.id,
      moderatedAt: now,
      publishedAt: params.decision === "publish" ? now : null,
    })
    .where(and(eq(productReviews.id, params.reviewId), eq(productReviews.status, "pending")))
    .returning({ id: productReviews.id, rating: productReviews.rating });

  if (!updated) {
    const [existing] = await db
      .select({ id: productReviews.id })
      .from(productReviews)
      .where(eq(productReviews.id, params.reviewId))
      .limit(1);
    return { ok: false, reason: existing ? "already-moderated" : "not-found" };
  }

  await recordAdminAction({
    actor: params.actor,
    action: params.decision === "publish" ? "review.publish" : "review.reject",
    targetType: "review",
    targetId: updated.id,
    summary: `${params.decision === "publish" ? "Published" : "Rejected"} a ${updated.rating}-star review${
      params.note ? `: ${params.note.slice(0, 300)}` : ""
    }`,
  });

  return { ok: true };
}

export type ModerationItem = PublicReview & {
  status: string;
  createdAt: Date;
  customerEmail: string;
  customerId: string;
  moderatorNote: string | null;
};

/**
 * The moderation queue. Unlike the public list this names the customer, because
 * an operator has to be able to see whether a review is a duplicate, abusive, or
 * attached to an order that was refunded after delivery.
 */
export async function listReviewsForModeration(status: "pending" | "published" | "rejected" | "all" = "pending") {
  // Two shapes rather than `where(undefined)`: the in-memory preview adapter
  // evaluates a missing condition as "match nothing", which would make the
  // "all" tab quietly empty.
  const rows =
    status === "all"
      ? await db
          .select()
          .from(productReviews)
          .orderBy(desc(productReviews.createdAt))
          .limit(200)
      : await db
          .select()
          .from(productReviews)
          .where(eq(productReviews.status, status))
          .orderBy(desc(productReviews.createdAt))
          .limit(200);

  if (rows.length === 0) return [] as ModerationItem[];

  const ids = [...new Set(rows.map((row) => row.userId))];
  const accounts = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(inArray(users.id, ids));
  const emails = new Map(accounts.map((account) => [account.id, account.email]));

  return rows.map((row) => ({
    id: row.id,
    service: row.service,
    productName: row.productName,
    rating: row.rating,
    headline: row.headline,
    body: row.body,
    publishedAt: row.publishedAt,
    status: row.status,
    createdAt: row.createdAt,
    customerEmail: emails.get(row.userId) ?? "unknown account",
    customerId: row.userId,
    moderatorNote: row.moderatorNote,
  }));
}

/** Count of reviews waiting on a decision, for the admin navigation badge. */
export async function pendingReviewCount(): Promise<number> {
  const rows = await db
    .select({ id: productReviews.id })
    .from(productReviews)
    .where(eq(productReviews.status, "pending"));
  return rows.length;
}
