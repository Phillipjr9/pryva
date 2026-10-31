import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { orders, productReviews, users } from "@/db/schema";

/**
 * Two things must hold on the public page: only published reviews appear, and
 * nothing on it identifies the customer. The moderation page is the opposite by
 * design — an operator needs the account — and that difference is asserted here
 * rather than left to a comment.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
}));

vi.mock("@/lib/auth", () => ({
  requireAdmin: vi.fn().mockResolvedValue({
    id: "33333333-3333-4333-8333-333333333333",
    email: "owner@pryva.ng",
    name: "Owner",
    walletBalance: 0,
    emailVerifiedAt: new Date("2026-01-02T00:00:00Z"),
    createdAt: new Date("2026-01-01T00:00:00Z"),
  }),
}));

import ReviewsPage from "@/app/(site)/reviews/page";
import AdminReviewsPage from "@/app/admin/reviews/page";

const buyer = "66666666-6666-4666-8666-666666666666";
const PENDING_BODY = "This one is still waiting for a decision and must not be public.";
const PUBLISHED_BODY = "The code arrived in under a minute and the number was accepted.";

async function seed() {
  await db.insert(users).values({
    id: buyer,
    name: "Ada Demo",
    email: "buyer@pryva.ng",
    passwordHash: "hash",
    walletBalance: 0,
    emailVerifiedAt: new Date(),
  });
  await db.insert(orders).values({
    id: "77777777-7777-4777-8777-777777777777",
    reference: "PV-REVIEW1",
    userId: buyer,
    service: "numbers",
    productSlug: "us-number",
    productName: "US virtual number",
    planLabel: "Single verification",
    region: "US",
    duration: "15 minutes",
    amount: 1500,
    status: "delivered",
    provider: "preview",
  });

  const base = {
    userId: buyer,
    service: "numbers",
    productName: "US virtual number",
    rating: 5,
    moderatorNote: null,
    moderatedBy: null,
    moderatedAt: null,
  };

  await db.insert(productReviews).values({
    orderId: "88888888-8888-4888-8888-888888888888",
    headline: "Fast and simple",
    body: PUBLISHED_BODY,
    status: "published",
    publishedAt: new Date("2026-10-20T09:00:00Z"),
    ...base,
  });
  await db.insert(productReviews).values({
    orderId: "99999999-9999-4999-8999-999999999999",
    headline: "Not public yet",
    body: PENDING_BODY,
    status: "pending",
    publishedAt: null,
    ...base,
  });
}

beforeEach(async () => {
  await db.delete(productReviews).where(eq(productReviews.userId, buyer));
});

describe("public reviews page", () => {
  it("shows published reviews and never the pending one", async () => {
    await seed();
    const html = renderToStaticMarkup(await ReviewsPage());

    expect(html).toContain(PUBLISHED_BODY);
    expect(html).toContain("Fast and simple");
    expect(html).toContain("Verified purchase");
    expect(html).not.toContain(PENDING_BODY);
    expect(html).not.toContain("Not public yet");
  });

  it("carries no customer identity", async () => {
    await seed();
    const html = renderToStaticMarkup(await ReviewsPage());

    expect(html).not.toContain("buyer@pryva.ng");
    expect(html).not.toContain("Ada Demo");
    expect(html).not.toContain("Ada");
  });

  it("says plainly when there is nothing to show, instead of inventing copy", async () => {
    await db.delete(productReviews).where(eq(productReviews.userId, buyer));
    const html = renderToStaticMarkup(await ReviewsPage());

    expect(html).toContain("No reviews published yet.");
    expect(html).toContain("We do not fill this page with examples");
  });
});

describe("admin moderation page", () => {
  it("names the account and offers a decision for a pending review", async () => {
    await seed();
    const html = renderToStaticMarkup(
      await AdminReviewsPage({ searchParams: Promise.resolve({ status: "pending" }) }),
    );

    expect(html).toContain("buyer@pryva.ng");
    expect(html).toContain(PENDING_BODY);
    expect(html).toContain("Publish");
    expect(html).toContain("Reject");
    expect(html).not.toContain(PUBLISHED_BODY);
  });

  it("lists published reviews under their own filter", async () => {
    await seed();
    const html = renderToStaticMarkup(
      await AdminReviewsPage({ searchParams: Promise.resolve({ status: "published" }) }),
    );

    expect(html).toContain(PUBLISHED_BODY);
    expect(html).not.toContain(PENDING_BODY);
  });
});
