import { afterEach, describe, expect, it, vi } from "vitest";
import { getBanks, resolveBankAccount } from "@/lib/paystack";

afterEach(() => vi.unstubAllGlobals());

describe("Paystack bank response parsing", () => {
  it("uses a validated bank directory and accepts the documented resolve response without bank_name", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ status: true, data: [
        { name: "Access Bank", code: "044" },
        { name: "Bad", code: "<script>" },
        { name: "", code: "001" },
      ] }))
      .mockResolvedValueOnce(Response.json({ status: true, data: { account_number: "1234567890", account_name: "Verified Person", bank_id: 1 } }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await getBanks()).toEqual([{ name: "Access Bank", code: "044" }]);
    expect(await resolveBankAccount("1234567890", "044")).toEqual({
      status: true, data: { account_number: "1234567890", account_name: "Verified Person", bank_id: 1 },
    });
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    const url = new URL(String(fetchMock.mock.calls[1][0]));
    expect(url.searchParams.get("account_number")).toBe("1234567890");
    expect(url.searchParams.get("bank_code")).toBe("044");
  });

  it("bounds provider responses and never includes provider error bodies in thrown errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response("{\"data\":\"" + "x".repeat(1_048_576) + "\"}"))
      .mockResolvedValueOnce(new Response("sensitive provider details", { status: 400 })));
    await expect(getBanks()).rejects.toThrow();
    await expect(getBanks()).rejects.toThrow("Paystack request failed (400)");
  });

  it("rejects a successful HTTP response with a failed provider status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ status: false, data: [] })));
    await expect(getBanks()).rejects.toThrow("Invalid bank directory response");
  });
});
