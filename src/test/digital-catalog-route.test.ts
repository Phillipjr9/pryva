import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), preview: vi.fn(), rate: vi.fn(), configured: vi.fn(), page: vi.fn(), codeOffers: vi.fn(), topupOffers: vi.fn(), esimOffers: vi.fn() }));
vi.mock("@/lib/identity/auth", () => ({ requireAuthApi: mocks.auth }));
vi.mock("@/lib/platform/financial-environment", () => ({ financialActionsUnavailable: mocks.preview }));
vi.mock("@/lib/platform/rate-limit", () => ({ catalogRateLimiter: mocks.rate }));
vi.mock("@/lib/providers/foxreload", () => ({ isFoxreloadConfigured: mocks.configured, readFoxreloadBrowsePage: mocks.page }));
vi.mock("@/lib/services/foxreload/code-orders", () => ({ listedCodeOffers: mocks.codeOffers }));
vi.mock("@/lib/services/foxreload/topup-orders", () => ({ listedTopupOffers: mocks.topupOffers }));
vi.mock("@/lib/services/foxreload/esim-orders", () => ({ listedEsimOffers: mocks.esimOffers }));
import { GET } from "@/app/api/services/digital-catalog/route";
import { ProviderError } from "@/lib/providers/types";
const request = (query = "") => new NextRequest(`https://example.test/api/services/digital-catalog${query}`);

beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ id: "user-1" });
  mocks.preview.mockReturnValue(false);
  mocks.configured.mockReturnValue(true);
  mocks.rate.mockResolvedValue({ allowed: true });
  mocks.codeOffers.mockReturnValue([]); mocks.topupOffers.mockReturnValue([]); mocks.esimOffers.mockReturnValue([]);
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
    expect((await GET(request("?category=bad%2Fpath"))).status).toBe(400);
    expect((await GET(request("?q=a"))).status).toBe(400);
    expect((await GET(request("?stock=invalid"))).status).toBe(400);
    expect((await GET(request("?q=game&cursor=x"))).status).toBe(400);
    expect((await GET(request(`?cursor=${"x".repeat(513)}`))).status).toBe(400);
    mocks.configured.mockReturnValueOnce(false);
    expect((await GET(request())).status).toBe(503);
    mocks.rate.mockResolvedValueOnce({ allowed: false, unavailable: true }).mockResolvedValueOnce({ allowed: false });
    expect((await GET(request())).status).toBe(503);
    expect((await GET(request())).status).toBe(429);
    expect(mocks.page).not.toHaveBeenCalled();
  });
  it("sends the rate-limit reset time instead of inviting immediate retries", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    mocks.rate.mockResolvedValueOnce({ allowed: false, resetTime: 1_040_000 });
    const response = await GET(request());
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("40");
    expect(mocks.page).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
  it("identifies an unavailable environment or an unconnected catalogue without exposing configuration", async () => {
    mocks.preview.mockReturnValueOnce(true);
    const preview = await GET(request());
    expect(preview.status).toBe(503);
    expect(await preview.json()).toMatchObject({ code: "environment" });
    mocks.configured.mockReturnValueOnce(false);
    const unconfigured = await GET(request());
    expect(unconfigured.status).toBe(503);
    expect(await unconfigured.json()).toMatchObject({ code: "unconfigured" });
    expect(mocks.page).not.toHaveBeenCalled();
  });
  it("only returns names, reported stock state and hashed IDs, never costs or fulfillment data", async () => {
    mocks.page.mockResolvedValueOnce({ rows: [{ id: "supplier-id", name: " Telegram Premium ", price: "5.00", currency: "usd", quantity: 40, requiredNoteFields: ["username"], userGuide: "private" }, {}, null], nextCursor: "next", searchLimited: false });
    const response = await GET(request("?cursor=previous"));
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const data = await response.json();
    expect(data).toEqual({ ok: true, items: [{ id: expect.stringMatching(/^digital-[a-f0-9]{24}$/), name: "Telegram Premium", stock: "reported", stockQuantity: 40, artwork: { kind: "brand", key: "telegram" } }], nextCursor: "next", searchLimited: false, skipped: true });
    expect(JSON.stringify(data)).not.toMatch(/supplier-id|5\.00|usd|username|private|quantity/);
    expect(mocks.page).toHaveBeenCalledWith({ query: undefined, cursor: "previous" });
  });
  it("returns only curated artwork keys for supplier slugs, not slugs or arbitrary image URLs", async () => {
    mocks.page.mockResolvedValueOnce({ rows: [
      { id: "cod", name: "80 + 8 CP", slug: "call-of-duty-mobile-activision-us-80-plus-8-cp", imagePath: "https://evil.test/tracker" },
      { id: "clash", name: "Clash Royale gems", slug: "clash-royale-gems" },
      { id: "unknown", name: "Mystery product", slug: "unrelated-product" },
    ], nextCursor: null, searchLimited: false });
    const data = await (await GET(request())).json();
    expect(data.items[0].artwork).toEqual({ kind: "local", key: "call-of-duty-mobile" });
    expect(data.items[1].artwork).toEqual({ kind: "category", key: "clash-royale" });
    expect(data.items[2]).not.toHaveProperty("artwork");
    expect(JSON.stringify(data)).not.toMatch(/evil|tracker|slug|activision-us-80/);
  });
  it("filters categories and links only exact approved products to checkout", async () => {
    const { createHash } = await import("node:crypto");
    const id = `digital-${createHash("sha256").update("supplier-1").digest("hex").slice(0, 24)}`;
    mocks.topupOffers.mockReturnValue([{ id, name: "Game", region: "US", min: 1, max: 1 }]);
    mocks.page.mockResolvedValue({ rows: [{ id: "supplier-1", name: "Game" }, { id: "supplier-2", name: "Other" }], nextCursor: null, searchLimited: false });
    const response = await GET(request("?category=topups&q=game"));
    const data = await response.json();
    expect(data.items).toEqual([{ id, name: "Game", stock: "unknown", stockQuantity: null, checkout: "topups" }, { id: expect.any(String), name: "Other", stock: "unknown", stockQuantity: null }]);
    expect(mocks.page).toHaveBeenCalledWith({ query: "game", cursor: undefined, category: "topups" });
    mocks.topupOffers.mockReturnValue([{ id, name: "Different product", region: "US", min: 1, max: 1 }]);
    expect((await (await GET(request())).json()).items[0]).not.toHaveProperty("checkout");
  });
  it("passes an optional stock filter and reports zero and malformed quantities honestly", async () => {
    mocks.page.mockResolvedValueOnce({ rows: [
      { id: "a", name: "Available", quantity: 3 }, { id: "b", name: "Sold out", quantity: 0 },
      { id: "c", name: "Missing" }, { id: "d", name: "Invalid", quantity: -1 },
    ], nextCursor: null, searchLimited: false });
    const data = await (await GET(request("?q=game&stock=available"))).json();
    expect(mocks.page).toHaveBeenCalledWith({ query: "game", cursor: undefined, inStockOnly: true });
    expect(data.items.map((item: { stock: string }) => item.stock)).toEqual(["reported", "out", "unknown", "unknown"]);
    expect(data.items.every((item: object) => !Object.hasOwn(item, "quantity"))).toBe(true);
    expect(data.items.every((item: object) => !Object.hasOwn(item, "checkout"))).toBe(true);
  });
  it("does not expose known supplier test orders as products", async () => {
    mocks.page.mockResolvedValueOnce({ rows: [
      { id: "test-1", name: "Test order", categoryId: "019ec7d3-db8f-7541-90a6-97469404a7df" },
      { id: "test-2", name: "Test order 2", slug: "test-orders-2" },
      { id: "real", name: "Real product", quantity: 1 },
    ], nextCursor: null, searchLimited: false });
    const data = await (await GET(request())).json();
    expect(data.items.map((item: { name: string }) => item.name)).toEqual(["Real product"]);
  });
  it("preserves an upstream throttle without revealing its error text", async () => {
    mocks.page.mockRejectedValueOnce(Object.assign(new ProviderError("secret provider details", { provider: "foxreload", status: 429 }), { retryAfterSeconds: 42 }));
    const response = await GET(request());
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("42");
    expect(await response.text()).not.toContain("secret");
  });
  it.each([401, 403])("treats supplier HTTP %s as a connection problem, not a shopper sign-in failure", async (status) => {
    mocks.page.mockRejectedValueOnce(new ProviderError("private credential", { provider: "foxreload", status }));
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(await response.json()).toEqual({ error: "This catalogue is not connected right now.", code: "unconfigured" });
  });
  it("hides upstream errors", async () => {
    mocks.page.mockRejectedValueOnce(new Error("private provider secret"));
    const response = await GET(request("?q=game"));
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("secret");
  });
});

describe("reported gift terms", () => {
  it("returns only validated face value and country, never the supplier price", async () => {
    mocks.page.mockResolvedValueOnce({ rows: [{ id: "gc", name: "Example Gift Card", deliveryType: "code", quantity: 1, price: "123.45", currency: "rub", attributes: { amount: 25, currency: "USD", face_value_amount: 25, face_value_currency: "USD", country_code: "US", private: "secret" } }], nextCursor: null, searchLimited: false });
    const data = await (await GET(request())).json();
    expect(data.items[0].reportedTerms).toEqual({ country: "US", value: { amount: 25, currency: "USD" } });
    expect(JSON.stringify(data)).not.toMatch(/123\.45|rub|secret|private/);
  });
  it("does not report conflicting or unsafe terms or accept non-code product terms", async () => {
    mocks.page.mockResolvedValueOnce({ rows: [
      { id: "a", name: "Card", deliveryType: "code", attributes: { country_code: "US", amount: 10, currency: "USD", face_value_amount: 20 } },
      { id: "b", name: "Bad", deliveryType: "code", attributes: { country_code: "<bad>", amount: -1, currency: "USD" } },
      { id: "c", name: "Other", deliveryType: "direct_topup", attributes: { country_code: "US", amount: 10, currency: "USD" } },
    ], nextCursor: null, searchLimited: false });
    const data = await (await GET(request())).json();
    expect(data.items[0].reportedTerms).toEqual({ country: "US" });
    expect(data.items[1]).not.toHaveProperty("reportedTerms");
    expect(data.items[2]).not.toHaveProperty("reportedTerms");
  });
});
