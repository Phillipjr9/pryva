import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Answering "why can nobody create a free inbox" without creating one.
 *
 * Four different refusals used to reach the customer as two sentences. This
 * endpoint names which one applies, and it must never buy an inbox to find out.
 */

const state = vi.hoisted(() => ({
  authorized: true,
  preview: false,
  configured: true,
  products: [] as unknown[],
  productsThrow: null as string | null,
  recent: [{ status: "active", total: 2 }] as { status: string; total: number }[],
  recentThrows: false,
}));

vi.mock("@/lib/diagnostics-auth", () => ({ diagnosticsAuthorized: () => state.authorized }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/demo-policy", () => ({ isPreviewDatabase: () => state.preview }));
vi.mock("@/lib/fleexa", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/fleexa")>();
  return {
    ...actual,
    isFleexaConfigured: () => state.configured,
    listFleexaEmailProducts: async () => {
      if (state.productsThrow) throw new Error(state.productsThrow);
      return state.products;
    },
  };
});
vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          groupBy: async () => {
            if (state.recentThrows) throw new Error("connection reset");
            return state.recent;
          },
        }),
      }),
    }),
  },
}));

import { GET } from "@/app/api/diagnostics/inbox/route";

function request() {
  return new NextRequest(new URL("https://pryva.test/api/diagnostics/inbox"));
}

function product(overrides: Record<string, unknown> = {}) {
  return { id: "p1", name: "Inbox", domain: null, priceNgn: 200, stock: 5, ...overrides };
}

beforeEach(() => {
  state.authorized = true;
  state.preview = false;
  state.configured = true;
  state.products = [product()];
  state.productsThrow = null;
  state.recent = [{ status: "active", total: 2 }];
  state.recentThrows = false;
});

describe("GET /api/diagnostics/inbox", () => {
  it("is secret-gated like the other diagnostics", async () => {
    state.authorized = false;
    const response = await GET(request());
    expect(response.status).toBe(401);
  });

  it("says ready when the feed lists something with stock", async () => {
    const body = await (await GET(request())).json();
    expect(body.verdict).toBe("ready");
    expect(body.products).toMatchObject({ readable: true, count: 1, usable: 1 });
    expect(body.products.cheapest.id).toBe("p1");
    expect(body.activeInboxes).toBe(2);
  });

  it("separates an unconfigured deployment from a preview one", async () => {
    state.configured = false;
    expect((await (await GET(request())).json()).verdict).toBe("not_configured");

    state.configured = true;
    state.preview = true;
    expect((await (await GET(request())).json()).verdict).toBe("preview");
  });

  it("distinguishes an unreachable feed from one that lists nothing", async () => {
    state.productsThrow = "Provider request failed";
    const unreachable = await (await GET(request())).json();
    expect(unreachable.verdict).toBe("unreachable");
    expect(unreachable.products.readable).toBe(false);

    state.productsThrow = null;
    state.products = [];
    const empty = await (await GET(request())).json();
    expect(empty.verdict).toBe("no_products");
  });

  it("ignores products the feed says are out of stock", async () => {
    state.products = [product({ id: "empty", stock: 0 })];
    const body = await (await GET(request())).json();
    expect(body.verdict).toBe("no_products");
    expect(body.products.usable).toBe(0);
  });

  it("still answers when the inbox table cannot be read", async () => {
    state.recentThrows = true;
    const body = await (await GET(request())).json();
    expect(body.verdict).toBe("ready");
    expect(body.last24Hours).toBe("unavailable");
  });

  it("never creates an inbox to find out whether creation works", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await GET(request());
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
