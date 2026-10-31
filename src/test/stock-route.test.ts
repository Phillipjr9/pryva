import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * The stock endpoint.
 *
 * It reports what feeds hold, so it is gated like the other diagnostics: a
 * read-only secret, no order in the payload, and a headline per lane so a script
 * watching it does not have to re-derive the answer.
 */

const state = vi.hoisted(() => ({ authorized: false, build: vi.fn() }));

vi.mock("@/lib/diagnostics-auth", () => ({ diagnosticsAuthorized: () => state.authorized }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/stock-live", () => ({ buildStockReport: state.build }));

import { GET } from "@/app/api/diagnostics/stock/route";

function request(url = "https://pryva.test/api/diagnostics/stock") {
  return new NextRequest(new URL(url));
}

beforeEach(() => {
  state.authorized = false;
  state.build.mockReset();
});

describe("GET /api/diagnostics/stock", () => {
  it("refuses an unauthenticated read", async () => {
    const response = await GET(request());
    expect(response.status).toBe(401);
    expect(state.build).not.toHaveBeenCalled();
  });

  it("returns the lanes with a headline each", async () => {
    state.authorized = true;
    state.build.mockResolvedValue({
      checkedAt: "2026-10-31T12:00:00.000Z",
      lanes: [
        {
          lane: "numbers",
          label: "Virtual numbers",
          connected: true,
          sellable: 2,
          total: 6,
          error: null,
          lines: [{ id: "vn-ng", label: "Nigeria number", state: "in-stock", stock: 12, note: "12 units" }],
        },
      ],
    });

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(body.lanes[0].headline).toBe("2 of 6 buyable now");
    expect(body.lanes[0].lines[0].stock).toBe(12);
  });

  it("passes a refresh request through to the feeds instead of the cache", async () => {
    state.authorized = true;
    state.build.mockResolvedValue({ checkedAt: "2026-10-31T12:00:00.000Z", lanes: [] });

    await GET(request("https://pryva.test/api/diagnostics/stock?refresh=1"));

    expect(state.build).toHaveBeenCalledWith({ refresh: true });
  });
});
