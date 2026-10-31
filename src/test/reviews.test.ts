import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { adminAuditLog, orders, productReviews, users } from "@/db/schema";
import {
  REVIEW_BODY_MAX,
  REVIEW_BODY_MIN,
  createReview,
  listPublishedReviews,
  listReviewableOrders,
  listReviewsForModeration,
  listUserReviews,
  moderateReview,
  normalizeReview,
  pendingReviewCount,
} from "@/lib/reviews";

/**
 * The promise of "verified purchase" is structural, not editorial: a review can
 * only come from the account that bought the order, only after delivery, once.
 * These tests hold that line, plus the two moderation rules — nothing public
 * until a human decides, and every decision audited.
 */

const buyer = "11111111-1111-4111-8111-111111111111";
const stranger = "22222222-2222-4222-8222-222222222222";
const admin = { id: "33333333-3333-4333-8333-333333333333", email: "owner@pryva.ng" };

let counter = 0;

function orderId() {
  counter += 1;
  return `4444444${counter}-4444-4444-8444-444444444444`.slice(0, 36);
}

async function seedUser(id: string, email: string) {
  await db.insert(users).values({
    id,
    name: "Ada Demo",
    email,
    passwordHash: "hash",
    walletBalance: 0,
    emailVerifiedAt: new Date(),
  });
}

async function seedOrder(params: {
  id: string;
  userId?: string;
  status?: string;
  productName?: string;
}) {
  await db.insert(orders).values({
    id: params.id,
    reference: `PV-${params.id.slice(-6).toUpperCase()}`,
    userId: params.userId ?? buyer,
    service: "numbers",
    productSlug: "us-number",
    productName: params.productName ?? "US virtual number",
    planLabel: "Single verification",
    region: "US",
    duration: "15 minutes",
    amount: 1500,
    status: params.status ?? "delivered",
    provider: "preview",
  });
}

beforeEach(async () => {
  await db.delete(productReviews).where(eq(productReviews.userId, buyer));
  await db.delete(productReviews).where(eq(productReviews.userId, stranger));
  await seedUser(buyer, "buyer@pryva.ng");
  await seedUser(stranger, "stranger@pryva.ng");
});

describe("review input validation", () => {
  it("accepts a well-formed review and trims it", () => {
    const result = normalizeReview({ rating: 4, headline: "  Fast  ", body: "  Delivered in under a minute.  " });
    expect(result).toEqual({
      ok: true,
      rating: 4,
      headline: "Fast",
      body: "Delivered in under a minute.",
    });
  });

  it("treats a blank headline as none", () => {
    const result = normalizeReview({ rating: 5, headline: "   ", body: "x".repeat(REVIEW_BODY_MIN) });
    expect(result.ok && result.headline).toBeNull();
  });

  it("rejects ratings outside 1–5 and non-integers", () => {
    for (const rating of [0, 6, 2.5, -1, "5", null]) {
      expect(normalizeReview({ rating, body: "x".repeat(REVIEW_BODY_MIN) })).toEqual({
        ok: false,
        reason: "rating",
      });
    }
  });

  it("rejects a body outside the allowed length", () => {
    expect(normalizeReview({ rating: 5, body: "x".repeat(REVIEW_BODY_MIN - 1) })).toEqual({
      ok: false,
      reason: "body",
    });
    expect(normalizeReview({ rating: 5, body: "x".repeat(REVIEW_BODY_MAX + 1) })).toEqual({
      ok: false,
      reason: "body",
    });
    expect(normalizeReview({ rating: 5, body: "x".repeat(REVIEW_BODY_MIN) }).ok).toBe(true);
  });

  it("rejects an over-long headline and a non-object body", () => {
    expect(normalizeReview({ rating: 5, headline: "x".repeat(81), body: "x".repeat(50) })).toEqual({
      ok: false,
      reason: "headline",
    });
    expect(normalizeReview("nope")).toEqual({ ok: false, reason: "rating" });
    expect(normalizeReview([])).toEqual({ ok: false, reason: "rating" });
  });
});

describe("who may review what", () => {
  it("refuses an order that belongs to somebody else", async () => {
    const id = orderId();
    await seedOrder({ id });

    const result = await createReview({
      userId: stranger,
      orderId: id,
      rating: 5,
      headline: null,
      body: "Trying to review another account's order.",
    });
    expect(result).toEqual({ ok: false, reason: "not-your-order" });
  });

  it("refuses an order that was not delivered", async () => {
    for (const status of ["processing", "active", "refunded", "cancelled", "review"]) {
      const id = orderId();
      await seedOrder({ id, status });
      const result = await createReview({
        userId: buyer,
        orderId: id,
        rating: 5,
        headline: null,
        body: "Reviewing something that never arrived.",
      });
      expect(result, status).toEqual({ ok: false, reason: "not-delivered" });
    }
  });

  it("accepts one review per delivered order and stores the purchase snapshot", async () => {
    const id = orderId();
    await seedOrder({ id, productName: "US virtual number" });

    const created = await createReview({
      userId: buyer,
      orderId: id,
      rating: 4,
      headline: "Worked",
      body: "Code arrived in under a minute and the number was accepted.",
    });
    expect(created.ok).toBe(true);

    const rows = await db.select().from(productReviews).where(eq(productReviews.orderId, id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: "pending",
      rating: 4,
      service: "numbers",
      productName: "US virtual number",
      headline: "Worked",
    });
    expect(rows[0].publishedAt).toBeNull();

    const again = await createReview({
      userId: buyer,
      orderId: id,
      rating: 5,
      headline: null,
      body: "A second attempt to raise the score after a refund.",
    });
    expect(again).toEqual({ ok: false, reason: "already-reviewed" });
  });

  it("drops a reviewed order out of the reviewable list", async () => {
    const reviewable = orderId();
    const reviewed = orderId();
    const undelivered = orderId();
    await seedOrder({ id: reviewable });
    await seedOrder({ id: reviewed });
    await seedOrder({ id: undelivered, status: "processing" });

    await createReview({
      userId: buyer,
      orderId: reviewed,
      rating: 3,
      headline: null,
      body: "Good enough, the number worked on the second attempt.",
    });

    const remaining = await listReviewableOrders(buyer);
    const ids = remaining.map((order) => order.id);
    expect(ids).toContain(reviewable);
    expect(ids).not.toContain(reviewed);
    expect(ids).not.toContain(undelivered);
  });
});

describe("nothing is public without a decision", () => {
  it("keeps pending reviews off the public list and carries no identity", async () => {
    const id = orderId();
    await seedOrder({ id });
    await createReview({
      userId: buyer,
      orderId: id,
      rating: 5,
      headline: "Excellent",
      body: "Number worked on the first attempt and the code came through instantly.",
    });

    expect(await listPublishedReviews()).toHaveLength(0);
    expect((await listUserReviews(buyer)).map((review) => review.status)).toEqual(["pending"]);
  });

  it("publishes on approval, stamps the time and writes an audit entry", async () => {
    const id = orderId();
    await seedOrder({ id });
    const created = await createReview({
      userId: buyer,
      orderId: id,
      rating: 5,
      headline: "Excellent",
      body: "Number worked on the first attempt and the code came through instantly.",
    });
    if (!created.ok) throw new Error("review was not created");

    expect(await moderateReview({ reviewId: created.id, decision: "publish", note: null, actor: admin })).toEqual({
      ok: true,
    });

    const publicList = await listPublishedReviews();
    expect(publicList).toHaveLength(1);
    expect(publicList[0].rating).toBe(5);
    expect(publicList[0].publishedAt).toBeInstanceOf(Date);
    // No customer identity is selected for the public page at all.
    expect(Object.keys(publicList[0]).sort()).toEqual(
      ["body", "headline", "id", "productName", "publishedAt", "rating", "service"].sort(),
    );

    const audit = await db.select().from(adminAuditLog);
    expect(audit.some((entry) => entry.action === "review.publish" && entry.targetId === created.id)).toBe(true);
  });

  it("refuses a second decision on the same review", async () => {
    const id = orderId();
    await seedOrder({ id });
    const created = await createReview({
      userId: buyer,
      orderId: id,
      rating: 2,
      headline: null,
      body: "The number worked but the rental ended earlier than advertised.",
    });
    if (!created.ok) throw new Error("review was not created");

    await moderateReview({ reviewId: created.id, decision: "reject", note: "Duplicate of an earlier review.", actor: admin });
    expect(
      await moderateReview({ reviewId: created.id, decision: "publish", note: null, actor: admin }),
    ).toEqual({ ok: false, reason: "already-moderated" });

    const [row] = await db.select().from(productReviews).where(eq(productReviews.id, created.id));
    expect(row.status).toBe("rejected");
    expect(row.publishedAt).toBeNull();
    expect(row.moderatorNote).toBe("Duplicate of an earlier review.");
    expect(await listPublishedReviews()).toHaveLength(0);
  });

  it("reports an unknown review instead of pretending to act", async () => {
    expect(
      await moderateReview({
        reviewId: "99999999-9999-4999-8999-999999999999",
        decision: "publish",
        note: null,
        actor: admin,
      }),
    ).toEqual({ ok: false, reason: "not-found" });
  });

  it("names the account in the moderation queue, and only there", async () => {
    const id = orderId();
    await seedOrder({ id });
    await createReview({
      userId: buyer,
      orderId: id,
      rating: 4,
      headline: null,
      body: "Straightforward purchase, the code arrived as described.",
    });

    const queue = await listReviewsForModeration("pending");
    expect(queue).toHaveLength(1);
    expect(queue[0].customerEmail).toBe("buyer@pryva.ng");
    expect(await pendingReviewCount()).toBeGreaterThanOrEqual(1);

    const published = await listReviewsForModeration("published");
    expect(published).toEqual([]);
    expect(await listReviewsForModeration("all")).toHaveLength(1);
  });
});
