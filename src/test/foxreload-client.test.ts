import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  foxreloadApiKey,
  isFoxreloadConfigured,
  getFoxreloadAccount,
  readFoxreloadBrowsePage,
  readFoxreloadProductContract,
  createFoxreloadContractOrder,
  submitFoxreloadClientCode,
  listFoxreloadCategories,
  listFoxreloadProducts,
  searchFoxreloadProducts,
  getFoxreloadProduct,
  createFoxreloadOrder,
  payFoxreloadOrder,
  getFoxreloadOrder,
  pollFoxreloadOrderCodes,
  resolveFoxreloadProductId,
  resetFoxreloadRateBudget,
  FoxreloadError,
} from "@/lib/providers/foxreload";

describe("FoxReload client", () => {
  const originalEnv = process.env.FOXRELOAD_API_KEY;

  beforeEach(async () => {
    process.env.FOXRELOAD_API_KEY = "fox_test_secret_key_12345";
    await resetFoxreloadRateBudget();
  });

  afterEach(() => {
    process.env.FOXRELOAD_API_KEY = originalEnv;
    vi.restoreAllMocks();
  });

  it("walks the documented catalogue with an opaque cursor and no inferred fields", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [{ id: "a", name: "Game", price: null }], nextCursor: "a+b/=" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [{ id: "b", name: "Telegram" }] }), { status: 200 }));
    const first = await readFoxreloadBrowsePage();
    expect(first).toEqual({ rows: [{ id: "a", name: "Game", price: null }], nextCursor: "a+b/=", searchLimited: false });
    const second = await readFoxreloadBrowsePage({ cursor: first.nextCursor! });
    expect(second.nextCursor).toBeNull();
    const firstUrl = new URL(String(fetchMock.mock.calls[0][0]));
    expect(firstUrl.pathname).toBe("/api/products/");
    expect(firstUrl.searchParams.get("includeDescendants")).toBe("true");
    expect(firstUrl.searchParams.get("limit")).toBe("50");
    expect(new URL(String(fetchMock.mock.calls[1][0])).searchParams.get("cursor")).toBe("a+b/=");
  });

  it("uses the search endpoint and reports a potentially truncated result", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify(Array.from({ length: 50 }, (_, i) => ({ id: String(i), name: "Game" }))), { status: 200 }));
    const result = await readFoxreloadBrowsePage({ query: "Game" });
    expect(result.searchLimited).toBe(true);
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.pathname).toBe("/api/products/search");
    expect(url.searchParams.get("query")).toBe("Game");
  });

  it("fails closed on malformed pages, excessive pages and a repeated cursor", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    for (const body of [[], { items: "wrong" }, { items: [], nextCursor: "x".repeat(513) }, { items: Array(51).fill({}), nextCursor: null }, { items: [], nextCursor: "same" }]) {
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status: 200 }));
      await expect(readFoxreloadBrowsePage({ cursor: "same" })).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    }
  });

  it("sends a documented mock Telegram Stars order with exact total and note", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({ id: "order" }), { status: 200 }));
    await createFoxreloadContractOrder({ product: { id: "product_stars", name: "Telegram Stars", currency: "usd", unitPrice: "0.0155", deliveryType: "direct_topup", quantity: 5000, minQuantity: 1, maxQuantity: 5000, requiredNoteFields: ["username"], noteFieldTypes: { username: "string" }, noteFieldOptions: {} }, quantity: 1337, note: { username: "monk" }, idempotencyKey: "merchant-order-123", mock: true });
    expect(new URL(String(fetchMock.mock.calls[0][0])).pathname).toBe("/api/orders/");
    const init = fetchMock.mock.calls[0][1]!;
    expect(JSON.parse(String(init.body))).toEqual({ items: [{ itemId: "product_stars", quantity: 1337, totalPrice: "20.7235", note: { username: "monk" } }], idempotencyKey: "merchant-order-123", isMock: true });
  });

  it("reads a specific fresh contract and verifies returned product identity", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({ id: "other", name: "Other" }), { status: 200 }));
    await expect(readFoxreloadProductContract("product_stars")).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("uses itemId and clientCode for a confirmation request", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("{}", { status: 200 }));
    const id = "0199a1c2-3d4e-7f50-8a6b-7c8d9e0f1a00";
    const item = "019e2100-6a2b-7d40-9c31-5f0e8b2a7c11";
    await submitFoxreloadClientCode(id, item, "12-34");
    expect(new URL(String(fetchMock.mock.calls[0][0])).pathname).toBe(`/api/orders/${id}/client-code`);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ itemId: item, clientCode: "12-34" });
    await expect(submitFoxreloadClientCode(id, item, "<bad>")).rejects.toMatchObject({ code: "INVALID_CLIENT_CODE" });
  });

  it("checks configuration correctly", () => {
    expect(isFoxreloadConfigured()).toBe(true);
    expect(foxreloadApiKey()).toBe("fox_test_secret_key_12345");

    process.env.FOXRELOAD_API_KEY = "";
    expect(isFoxreloadConfigured()).toBe(false);
    expect(foxreloadApiKey()).toBeNull();
  });

  it("rejects calls when API key is missing", async () => {
    process.env.FOXRELOAD_API_KEY = "";
    await expect(getFoxreloadAccount()).rejects.toThrow("FOXRELOAD_API_KEY is not configured");
  });

  it("fetches account standing and balance", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: "usr_99",
          email: "reseller@example.com",
          balance: 1420.5,
          currency: "usd",
          tier: "gold",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const account = await getFoxreloadAccount();
    expect(account).toEqual({
      id: "usr_99",
      email: "reseller@example.com",
      balance: 1420.5,
      currency: "usd",
      tier: "gold",
    });
  });

  it("lists catalog categories and products", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            { id: "cat_1", name: "Gift Cards", slug: "gift-cards" },
            { id: "cat_2", name: "Gaming", slug: "gaming" },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            items: [
              {
                id: "steam_10_usd",
                name: "Steam $10 USD",
                slug: "steam-10-usd",
                categoryId: "cat_1",
                price: 9.2,
                currency: "usd",
                quantity: 45,
                deliveryType: "code",
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );

    const categories = await listFoxreloadCategories();
    expect(categories).toHaveLength(2);
    expect(categories[0].name).toBe("Gift Cards");

    const products = await listFoxreloadProducts({ categoryIdOrSlug: "gift-cards" });
    expect(products).toHaveLength(1);
    expect(products[0]).toMatchObject({
      id: "steam_10_usd",
      name: "Steam $10 USD",
      price: 9.2,
      deliveryType: "code",
    });
  });

  it("creates, pays, and polls for delivered voucher codes", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        // POST /api/orders/
        new Response(
          JSON.stringify({
            id: "ord_fox123",
            status: "pending",
            items: [{ id: "item_1", itemId: "steam_10_usd", quantity: 1, status: "pending", externalData: [] }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        // POST /api/orders/{id}/pay
        new Response(
          JSON.stringify({
            id: "ord_fox123",
            status: "processing",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        // GET /api/orders/{id}
        new Response(
          JSON.stringify({
            id: "ord_fox123",
            status: "completed",
            items: [
              {
                id: "item_1",
                itemId: "steam_10_usd",
                quantity: 1,
                status: "completed",
                externalData: ["RBLX-X7K2-9MPQ-4WR1"],
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );

    const order = await createFoxreloadOrder({
      itemId: "steam_10_usd",
      quantity: 1,
      idempotencyKey: "test-req-123",
    });
    expect(order.id).toBe("ord_fox123");
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://public-api.foxreload.com/api/orders/",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          items: [{ itemId: "steam_10_usd", quantity: 1 }],
          isMock: false,
          idempotencyKey: "test-req-123",
        }),
      }),
    );

    const payResult = await payFoxreloadOrder(order.id);
    expect(payResult.status).toBe("processing");

    const codes = await pollFoxreloadOrderCodes(order.id, { maxWaitMs: 3000, intervalMs: 100 });
    expect(codes).toEqual(["RBLX-X7K2-9MPQ-4WR1"]);
  });

  it("resolves FoxReload product ID from preferred ID or search query", async () => {
    // 1. Direct typeid or uuid resolves without fetch
    const direct = await resolveFoxreloadProductId({
      brand: "Steam",
      amountUsd: 10,
      preferredId: "product_01krgfgww8eth9xvvysd6y7r4j",
    });
    expect(direct).toBe("product_01krgfgww8eth9xvvysd6y7r4j");

    // 2. Search resolution
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          items: [
            {
              id: "product_resolved_steam10",
              name: "Steam $10 USD Gift Card",
              price: 10,
              deliveryType: "code",
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const resolved = await resolveFoxreloadProductId({
      brand: "Steam",
      amountUsd: 10,
    });
    expect(resolved).toBe("product_resolved_steam10");
  });

  it("propagates provider errors cleanly without crash", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: {
            code: "INSUFFICIENT_BALANCE",
            message: "Not enough reseller balance to place order",
          },
        }),
        { status: 402, headers: { "Content-Type": "application/json" } },
      ),
    );

    await expect(createFoxreloadOrder({ itemId: "steam_10_usd" })).rejects.toMatchObject({
      name: "FoxreloadError",
      status: 402,
      code: "INSUFFICIENT_BALANCE",
    });
  });
});
