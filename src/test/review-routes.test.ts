import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  admin: vi.fn(),
  limit: vi.fn(),
  create: vi.fn(),
  list: vi.fn(),
  moderate: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireAuthApi: mocks.user }));
vi.mock("@/lib/admin-auth", () => ({ authorizeAdminApi: mocks.admin }));
vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>();
  return { ...actual, reviewRateLimiter: mocks.limit };
});
vi.mock("@/lib/reviews", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/reviews")>();
  return {
    ...actual,
    createReview: mocks.create,
    listReviewsForModeration: mocks.list,
    moderateReview: mocks.moderate,
  };
});

import { POST as createRoute } from "@/app/api/reviews/route";
import { GET as adminList, POST as adminDecide } from "@/app/api/admin/reviews/route";

const ORDER = "44444444-4444-4444-8444-444444444444";
const REVIEW = "55555555-5555-4555-8555-555555555555";

function get(url: string) {
  return new NextRequest(url, { headers: { host: "pryva.test", "x-forwarded-proto": "https" } });
}

function post(url: string, body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(url, {
    method: "POST",
    headers: {
      host: "pryva.test",
      "x-forwarded-proto": "https",
      origin: "https://pryva.test",
      "content-type": "application/json",
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const validReview = {
  orderId: ORDER,
  rating: 5,
  headline: "Worked",
  body: "The code arrived in under a minute and the number was accepted.",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue({ id: "user-1", email: "buyer@pryva.ng" });
  mocks.limit.mockResolvedValue({ allowed: true, unavailable: false });
  mocks.create.mockResolvedValue({ ok: true, id: REVIEW });
  mocks.list.mockResolvedValue([]);
  mocks.moderate.mockResolvedValue({ ok: true });
  mocks.admin.mockResolvedValue({
    user: { id: "admin-1", email: "owner@pryva.ng" },
    response: null,
  });
});

describe("POST /api/reviews", () => {
  it("requires a session, a same-origin request and JSON", async () => {
    mocks.user.mockResolvedValueOnce(null);
    expect((await createRoute(post("https://pryva.test/api/reviews", validReview))).status).toBe(401);

    expect(
      (await createRoute(post("https://pryva.test/api/reviews", validReview, { origin: "https://evil.test" })))
        .status,
    ).toBe(403);

    expect(
      (await createRoute(post("https://pryva.test/api/reviews", validReview, { "content-type": "text/plain" })))
        .status,
    ).toBe(415);
  });

  it("fails closed when the limiter is unavailable, and refuses a flood", async () => {
    mocks.limit.mockResolvedValueOnce({ allowed: false, unavailable: true });
    expect((await createRoute(post("https://pryva.test/api/reviews", validReview))).status).toBe(503);

    mocks.limit.mockResolvedValueOnce({ allowed: false, unavailable: false });
    expect((await createRoute(post("https://pryva.test/api/reviews", validReview))).status).toBe(429);

    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("validates the order, the rating and the body before touching the database", async () => {
    const cases: Array<[unknown, number]> = [
      [{ ...validReview, orderId: "not-a-uuid" }, 400],
      [{ ...validReview, rating: 0 }, 400],
      [{ ...validReview, rating: 4.5 }, 400],
      [{ ...validReview, body: "too short" }, 400],
      [{ ...validReview, headline: "x".repeat(81) }, 400],
      [{ ...validReview, body: "x".repeat(1_201) }, 400],
    ];
    for (const [body, status] of cases) {
      expect((await createRoute(post("https://pryva.test/api/reviews", body))).status, JSON.stringify(body).slice(0, 60)).toBe(status);
    }
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("maps the eligibility rules to distinct answers", async () => {
    mocks.create.mockResolvedValueOnce({ ok: false, reason: "not-your-order" });
    expect((await createRoute(post("https://pryva.test/api/reviews", validReview))).status).toBe(404);

    mocks.create.mockResolvedValueOnce({ ok: false, reason: "not-delivered" });
    expect((await createRoute(post("https://pryva.test/api/reviews", validReview))).status).toBe(409);

    mocks.create.mockResolvedValueOnce({ ok: false, reason: "already-reviewed" });
    expect((await createRoute(post("https://pryva.test/api/reviews", validReview))).status).toBe(409);
  });

  it("stores a valid review as pending and returns its id", async () => {
    const response = await createRoute(post("https://pryva.test/api/reviews", validReview));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, id: REVIEW, status: "pending" });

    expect(mocks.create).toHaveBeenCalledWith({
      userId: "user-1",
      orderId: ORDER,
      rating: 5,
      headline: "Worked",
      body: "The code arrived in under a minute and the number was accepted.",
    });
  });
});

describe("admin review moderation", () => {
  it("refuses an unauthenticated or non-admin caller", async () => {
    mocks.admin.mockResolvedValueOnce({
      user: null,
      response: Response.json({ ok: false }, { status: 403 }),
    });
    const response = await adminList(get("https://pryva.test/api/admin/reviews"));
    expect(response.status).toBe(403);
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it("defaults to the pending queue and ignores an unknown filter", async () => {
    await adminList(get("https://pryva.test/api/admin/reviews?status=whatever"));
    expect(mocks.list).toHaveBeenCalledWith("pending");

    await adminList(get("https://pryva.test/api/admin/reviews?status=all"));
    expect(mocks.list).toHaveBeenLastCalledWith("all");
  });

  it("validates the decision and the note", async () => {
    for (const body of [
      { reviewId: REVIEW, decision: "delete" },
      { reviewId: "nope", decision: "publish" },
      { reviewId: REVIEW, decision: "publish", note: "x".repeat(501) },
    ]) {
      expect(
        (await adminDecide(post("https://pryva.test/api/admin/reviews", body))).status,
        JSON.stringify(body).slice(0, 60),
      ).toBe(400);
    }
    expect(mocks.moderate).not.toHaveBeenCalled();
  });

  it("reports a stale or missing review instead of claiming success", async () => {
    mocks.moderate.mockResolvedValueOnce({ ok: false, reason: "already-moderated" });
    expect(
      (await adminDecide(post("https://pryva.test/api/admin/reviews", { reviewId: REVIEW, decision: "publish" })))
        .status,
    ).toBe(409);

    mocks.moderate.mockResolvedValueOnce({ ok: false, reason: "not-found" });
    expect(
      (await adminDecide(post("https://pryva.test/api/admin/reviews", { reviewId: REVIEW, decision: "reject" })))
        .status,
    ).toBe(404);
  });

  it("passes the decision to the library with the operator as the actor", async () => {
    const response = await adminDecide(
      post("https://pryva.test/api/admin/reviews", {
        reviewId: REVIEW,
        decision: "reject",
        note: "Contains personal contact details.",
      }),
    );
    expect(response.status).toBe(200);
    expect(mocks.moderate).toHaveBeenCalledWith({
      reviewId: REVIEW,
      decision: "reject",
      note: "Contains personal contact details.",
      actor: { id: "admin-1", email: "owner@pryva.ng" },
    });
  });
});
