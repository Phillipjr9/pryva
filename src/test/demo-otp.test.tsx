import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { renderToStaticMarkup } from "react-dom/server";
import { OrderActions } from "@/components/dashboard/OrderActions";
import { findPlan } from "@/lib/catalog";
import { provisionPlan } from "@/lib/provision";

const mocks = vi.hoisted(() => ({ user: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/rate-limit", () => ({ demoRateLimiter: async () => ({ allowed: true }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

let database: typeof import("@/db");
let schema: typeof import("@/db/schema");
let delivery: typeof import("@/lib/demo-delivery");
let route: typeof import("@/app/api/demo/orders/[id]/delivery/route");
const now = Date.parse("2030-01-01T00:00:00Z");

beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", "");
  [database, schema, delivery, route] = await Promise.all([
    import("@/db"), import("@/db/schema"), import("@/lib/demo-delivery"), import("@/app/api/demo/orders/[id]/delivery/route"),
  ]);
});
beforeEach(() => { vi.stubEnv("DATABASE_URL", ""); mocks.user.mockReset(); });

async function makeOrder(overrides: Record<string, unknown> = {}) {
  const userId = randomUUID();
  await database.db.insert(schema.users).values({ id: userId, name: "Tester", email: `${userId}@example.test`, passwordHash: "hash", walletBalance: 1000 });
  const orderId = randomUUID();
  await database.db.insert(schema.orders).values({
    id: orderId, userId, reference: `T-${orderId}`, service: "numbers", productSlug: "vn-ng", productName: "Demo number",
    planLabel: "Single", region: "Nigeria", duration: "20 min", amount: 1000, status: "active", provider: "simulated",
    referenceCode: "+000 555 1234", otpCode: null, createdAt: new Date(now), expiresAt: new Date(now + 1_200_000), ...overrides,
  });
  return { userId, orderId };
}

describe("demo code delivery", () => {
  it("waits briefly, delivers once, and scopes the order to its owner", async () => {
    const { userId, orderId } = await makeOrder();
    expect(delivery.advanceDemoOtp(randomUUID(), orderId, now + 9000)).toBeNull();
    expect(delivery.advanceDemoOtp(userId, orderId, now)).toMatchObject({ waiting: true, otpCode: null });
    const ready = delivery.advanceDemoOtp(userId, orderId, now + delivery.DEMO_OTP_DELAY_MS)!;
    expect(ready).toMatchObject({ waiting: false, otpCode: expect.stringMatching(/^\d{6}$/) });
    expect(delivery.advanceDemoOtp(userId, orderId, now + 20000)).toEqual(ready);
    const notices = await database.db.query.notifications.findMany({ where: eq(schema.notifications.userId, userId) });
    expect(notices).toHaveLength(1);
  });

  it("does not create codes for expired, refunded or non-demo orders", async () => {
    for (const overrides of [
      { expiresAt: new Date(now + 1) },
      { expiresAt: new Date("invalid") },
      { createdAt: new Date("invalid") },
      { status: "refunded", refundedAt: new Date(now) },
      { provider: "fleexa" },
    ]) {
      const { userId, orderId } = await makeOrder(overrides);
      const result = delivery.advanceDemoOtp(userId, orderId, now + 9000);
      expect(result?.otpCode ?? null).toBeNull();
    }
  });

  it("keeps the mutation same-origin and inaccessible with a persistent database", async () => {
    const { userId, orderId } = await makeOrder();
    mocks.user.mockResolvedValue({ id: userId });
    const req = (origin: string) => new NextRequest(`https://pryva.test/api/demo/orders/${orderId}/delivery`, { method: "POST", headers: { origin, host: "pryva.test", "x-forwarded-proto": "https" } });
    expect((await route.POST(req("https://evil.test"), { params: Promise.resolve({ id: orderId }) })).status).toBe(403);
    vi.stubEnv("DATABASE_URL", "postgres://persistent.test/db");
    expect((await route.POST(req("https://pryva.test"), { params: Promise.resolve({ id: orderId }) })).status).toBe(404);
  });

  it("uses clearly fictional addresses and renders waiting/arrival states", () => {
    expect(provisionPlan(findPlan("vn-ng")!)).toMatchObject({ referenceCode: expect.stringMatching(/^\+000 /), otpCode: null });
    expect(provisionPlan(findPlan("email-24")!)).toMatchObject({ referenceCode: expect.stringMatching(/@example\.test$/), otpCode: null });
    const props = { orderId: "demo-order", status: "active", expiresAt: new Date(now + 60000).toISOString(), amount: 1000,
      referenceCode: "+000 555 1234", service: "numbers", provider: "simulated", preview: true, canRequestPreviewRefund: false, initialNow: now };
    const waiting = renderToStaticMarkup(<OrderActions {...props} otpCode={null} />);
    expect(waiting).toContain("Waiting for your demo code");
    expect(waiting).toContain("Demo active");
    const arrived = renderToStaticMarkup(<OrderActions {...props} otpCode="123456" />);
    expect(arrived).toContain("Demo code received");
    expect(arrived).toContain("Verification code 123456");
    expect(arrived).toContain("not eligible for a demo refund");
    expect(arrived).not.toContain("Refunds require review");
  });
});
