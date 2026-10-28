import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ user: vi.fn(), limit: vi.fn(), orders: vi.fn(), transactions: vi.fn(), cards: vi.fn(), scheduled: vi.fn(), profile: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireAuthApi: mocks.user }));
vi.mock("@/lib/rate-limit", () => ({ userExportRateLimiter: mocks.limit }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), error: vi.fn() } }));
vi.mock("@/db", () => ({ db: { query: {
  users: { findFirst: mocks.profile }, orders: { findMany: mocks.orders },
  walletTransactions: { findMany: mocks.transactions }, giftCards: { findMany: mocks.cards },
  scheduledOrders: { findMany: mocks.scheduled },
} } }));
import { GET } from "@/app/api/user/export/route";

const request = () => new NextRequest("https://pryva.test/api/user/export");
beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue({ id: "user-id" });
  mocks.limit.mockResolvedValue({ allowed: true });
  mocks.profile.mockResolvedValue({ id: "user-id", name: "Person", email: "user@example.com", walletBalance: 0, createdAt: new Date() });
  mocks.orders.mockResolvedValue([]);
  mocks.transactions.mockResolvedValue([]);
  mocks.cards.mockResolvedValue([]);
  mocks.scheduled.mockResolvedValue([]);
});

describe("selected account export", () => {
  it("is private and explicitly describes its limited and sensitive scope", async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect((await response.json()).scope).toMatch(/Selected account activity only.*gift-card codes/);
  });

  it("fails closed when throttling is unavailable and refuses to silently truncate", async () => {
    mocks.limit.mockResolvedValueOnce({ allowed: false, unavailable: true });
    expect((await GET(request())).status).toBe(503);
    expect(mocks.orders).not.toHaveBeenCalled();
    mocks.orders.mockResolvedValueOnce(Array(5001).fill({}));
    expect((await GET(request())).status).toBe(413);
  });
});
