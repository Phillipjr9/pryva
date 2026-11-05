import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ authorize: vi.fn(), select: vi.fn(), credit: vi.fn(), debit: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ authorizeAdminApi: mocks.authorize }));
vi.mock("@/db", () => ({ db: { select: mocks.select } }));
vi.mock("@/lib/wallet", () => ({ creditWallet: mocks.credit, debitWallet: mocks.debit, InsufficientFundsError: class extends Error {} }));

import { PUT } from "@/app/api/admin/users/[id]/route";

afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe("preview admin wallet isolation", () => {
  it("refuses wallet adjustments before looking up or changing shared records", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://mock.invalid/db");
    vi.stubEnv("VERCEL_ENV", "preview");
    mocks.authorize.mockResolvedValue({ response: null, user: { id: "admin", email: "admin@example.test" } });
    const request = new NextRequest("https://example.test/api/admin/users/1", {
      method: "PUT", headers: { origin: "https://example.test", "content-type": "application/json" },
      body: JSON.stringify({ action: "credit", amount: 1000 }),
    });
    const response = await PUT(request, { params: Promise.resolve({ id: "1" }) });
    expect(response.status).toBe(503);
    expect(mocks.authorize).toHaveBeenCalledOnce();
    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.credit).not.toHaveBeenCalled();
    expect(mocks.debit).not.toHaveBeenCalled();
  });
});
