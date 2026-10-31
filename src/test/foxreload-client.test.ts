import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  foxreloadApiKey,
  isFoxreloadConfigured,
  getFoxreloadAccount,
  listFoxreloadCategories,
  listFoxreloadProducts,
  searchFoxreloadProducts,
  getFoxreloadProduct,
  createFoxreloadOrder,
  payFoxreloadOrder,
  getFoxreloadOrder,
  pollFoxreloadOrderCodes,
  resetFoxreloadRateBudget,
  FoxreloadError,
} from "@/lib/foxreload";

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
    vi.spyOn(globalThis, "fetch")
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

    const order = await createFoxreloadOrder({ itemId: "steam_10_usd", quantity: 1 });
    expect(order.id).toBe("ord_fox123");

    const payResult = await payFoxreloadOrder(order.id);
    expect(payResult.status).toBe("processing");

    const codes = await pollFoxreloadOrderCodes(order.id, { maxWaitMs: 3000, intervalMs: 100 });
    expect(codes).toEqual(["RBLX-X7K2-9MPQ-4WR1"]);
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
