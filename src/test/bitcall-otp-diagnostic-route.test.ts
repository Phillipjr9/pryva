import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ requireAdmin: vi.fn(), inspect: vi.fn() }));

vi.mock("@/lib/identity/auth", () => ({ requireAdmin: state.requireAdmin }));
vi.mock("@/lib/providers/bitcall", () => ({
  BitcallError: class BitcallError extends Error {
    status: number;
    code: string;
    requestId: string | null;
    constructor(message: string, status: number, code: string, requestId: string | null = null) {
      super(message);
      this.status = status;
      this.code = code;
      this.requestId = requestId;
    }
  },
  inspectBitcallOtpCatalog: state.inspect,
}));

import { BitcallError } from "@/lib/providers/bitcall";
import { GET } from "@/app/api/admin/diagnostics/bitcall-otp/route";

beforeEach(() => {
  state.requireAdmin.mockReset().mockResolvedValue(undefined);
  state.inspect.mockReset();
});

describe("GET /api/admin/diagnostics/bitcall-otp", () => {
  it("requires the admin session and returns the sanitized inspection without caching", async () => {
    const diagnostics = { configured: true, parsedServiceCount: 0, topLevelKeys: ["data"] };
    state.inspect.mockResolvedValue(diagnostics);

    const response = await GET();

    expect(state.requireAdmin).toHaveBeenCalledWith("/admin/stock");
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ ok: true, diagnostics });
  });

  it("does not expose provider error messages or credential data", async () => {
    state.inspect.mockRejectedValue(new BitcallError("secret payload must not escape", 401, "INVALID_API_KEY", "req-safe-id"));

    const response = await GET();

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      ok: false,
      error: { code: "INVALID_API_KEY", status: 401, requestId: "req-safe-id" },
    });
  });
});
