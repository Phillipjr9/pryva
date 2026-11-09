import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), preview: vi.fn(), rate: vi.fn(), configured: vi.fn(), page: vi.fn() }));
vi.mock("@/lib/identity/auth", () => ({ requireAuthApi: mocks.auth }));
vi.mock("@/lib/platform/financial-environment", () => ({ financialActionsUnavailable: mocks.preview }));
vi.mock("@/lib/platform/rate-limit", () => ({ catalogRateLimiter: mocks.rate }));
vi.mock("@/lib/providers/foxreload", () => ({ isFoxreloadConfigured: mocks.configured, readFoxreloadBrowsePage: mocks.page }));
import { GET } from "@/app/api/services/digital-catalog/route";
const request = (query = "") => new NextRequest(`https://example.test/api/services/digital-catalog${query}`);

beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ id: "user-1" });
  mocks.preview.mockReturnValue(false);
  mocks.configured.mockReturnValue(true);
  mocks.rate.mockResolvedValue({ allowed: true });
  mocks.page.mockResolvedValue({ rows: [], nextCursor: null, searchLimited: false });
});

describe("read-only digital catalogue route", () => {
  it("requires an authenticated user and blocks previews before provider access", async () => {
    mocks.auth.mockResolvedValueOnce(null);
    expect((await GET(request())).status).toBe(401);
    mocks.preview.mockReturnValueOnce(true);
    expect((await GET(request())).status).toBe(503);
    expect(mocks.page).not.toHaveBeenCalled();
  });
  it("validates query and cursor and fails closed on configuration and rate limits", async () => {
    expect((await GET(request("?q=a"))).status).toBe(400);
    expect((await GET(request("?q=game&cursor=x"))).status).toBe(400);
    expect((await GET(request(`?cursor=${"x".repeat(513)}`))).status).toBe(400);
    mocks.configured.mockReturnValueOnce(false);
    expect((await GET(request())).status).toBe(503);
    mocks.rate.mockResolvedValueOnce({ allowed: false, unavailable: true }).mockResolvedValueOnce({ allowed: false });
    expect((await GET(request())).status).toBe(503);
    expect((await GET(request())).status).toBe(429);
    expect(mocks.page).not.toHaveBeenCalled();
  });
  it("only returns names and hashed IDs, never costs, stock or fulfillment data", async () => {
    mocks.page.mockResolvedValueOnce({ rows: [{ id: "supplier-id", name: " Telegram Premium ", price: "5.00", currency: "usd", quantity: 40, requiredNoteFields: ["username"], userGuide: "private" }, {}, null], nextCursor: "next", searchLimited: false });
    const response = await GET(request("?cursor=previous"));
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const data = await response.json();
    expect(data).toEqual({ ok: true, items: [{ id: expect.stringMatching(/^digital-[a-f0-9]{24}$/), name: "Telegram Premium" }], nextCursor: "next", searchLimited: false, skipped: true });
    expect(JSON.stringify(data)).not.toMatch(/supplier-id|5\.00|usd|username|private|quantity/);
    expect(mocks.page).toHaveBeenCalledWith({ query: undefined, cursor: "previous" });
  });
  it("hides upstream errors", async () => {
    mocks.page.mockRejectedValueOnce(new Error("private provider secret"));
    const response = await GET(request("?q=game"));
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("secret");
  });
});
