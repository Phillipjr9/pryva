import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The shared checkout gates.
 *
 * Six purchase routes each wrote this prologue themselves until now, in five
 * different orders and with different answers. The drift was concrete: referral
 * settlement ran on two of them, the hourly velocity ceiling on three, and an
 * anonymous caller got `{error}` from one route and `{ok:false,error}` from the
 * next. What follows pins the contract those routes now share.
 */

const state = vi.hoisted(() => ({
  user: { id: "user-1", email: "ada@example.test", walletBalance: 5_000 } as Record<string, unknown> | null,
  blocked: false,
  limit: { allowed: true, remaining: 4, resetTime: Date.now() + 30_000, unavailable: false },
  velocity: { allowed: true, count: 0, limit: 30 },
  recorded: [] as unknown[],
  emails: 0,
  settled: [] as string[],
  settleFails: false,
}));

vi.mock("@/lib/identity/auth", () => ({
  getCurrentUser: async () => state.user,
  requireAuthApi: async () => state.user,
}));
vi.mock("@/lib/platform/financial-environment", () => ({
  financialActionsUnavailable: () => state.blocked,
}));
vi.mock("@/lib/platform/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/platform/rate-limit")>();
  return { ...actual, purchaseRateLimiter: async () => state.limit };
});
vi.mock("@/lib/admin/fraud", () => ({
  purchaseVelocity: async () => state.velocity,
  recordFraudEvent: async (event: unknown) => {
    state.recorded.push(event);
  },
}));
vi.mock("@/lib/email/schedule-wallet-emails", () => ({
  scheduleWalletEmails: () => {
    state.emails += 1;
  },
}));
vi.mock("@/lib/content/referrals", () => ({
  settleReferralRewards: async (options: { refereeId: string }) => {
    state.settled.push(options.refereeId);
    if (state.settleFails) throw new Error("referral ledger unavailable");
  },
}));

const { beginPurchase, afterPurchase } = await import("@/lib/checkout/purchase");

const ORIGIN = "https://pryva.test";

function request(
  body: unknown = { planSlug: "vn-ng" },
  options: { method?: string; headers?: Record<string, string>; raw?: string } = {},
): Request {
  return new Request(`${ORIGIN}/api/orders`, {
    method: options.method ?? "POST",
    headers: { origin: ORIGIN, "content-type": "application/json", ...options.headers },
    body: options.raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
}

const gates = { bucket: "order-create" };

beforeEach(() => {
  state.user = { id: "user-1", email: "ada@example.test", walletBalance: 5_000 };
  state.blocked = false;
  state.limit = { allowed: true, remaining: 4, resetTime: Date.now() + 30_000, unavailable: false };
  state.velocity = { allowed: true, count: 0, limit: 30 };
  state.recorded = [];
  state.emails = 0;
  state.settled = [];
  state.settleFails = false;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the gates, in order", () => {
  it("refuses an anonymous caller before doing anything else", async () => {
    state.user = null;
    const begun = await beginPurchase(request(), gates);
    expect(begun.ok).toBe(false);
    if (begun.ok) return;
    expect(begun.response.status).toBe(401);
    expect(await begun.response.json()).toMatchObject({ ok: false, error: /sign in/i });
  });

  it("refuses a cross-origin POST", async () => {
    const begun = await beginPurchase(request(undefined, { headers: { origin: "https://evil.test" } }), gates);
    expect(begun.ok).toBe(false);
    if (begun.ok) return;
    expect(begun.response.status).toBe(403);
  });

  it("refuses a form post", async () => {
    const begun = await beginPurchase(
      request(undefined, { headers: { "content-type": "application/x-www-form-urlencoded" } }),
      gates,
    );
    expect(begun.ok).toBe(false);
    if (begun.ok) return;
    expect(begun.response.status).toBe(415);
  });

  it("refuses the preview environment with the route's own wording", async () => {
    state.blocked = true;
    const begun = await beginPurchase(request(), { ...gates, copy: { unavailable: "eSIM ordering is unavailable in this environment." } });
    expect(begun.ok).toBe(false);
    if (begun.ok) return;
    expect(begun.response.status).toBe(503);
    expect(await begun.response.json()).toMatchObject({ error: "eSIM ordering is unavailable in this environment." });
  });

  it("refuses a product whose supplier gate is closed, before touching the body", async () => {
    const read = vi.fn();
    const begun = await beginPurchase(request(), {
      ...gates,
      supplierGate: { open: () => false, message: "Account purchases are temporarily unavailable." },
    });
    expect(begun.ok).toBe(false);
    if (begun.ok) return;
    expect(begun.response.status).toBe(503);
    expect(read).not.toHaveBeenCalled();
  });

  it("fails closed when the limiter store is down, and refuses a flood", async () => {
    state.limit = { allowed: false, remaining: 0, resetTime: Date.now(), unavailable: true };
    const down = await beginPurchase(request(), gates);
    expect(down.ok).toBe(false);
    if (!down.ok) expect(down.response.status).toBe(503);

    state.limit = { allowed: false, remaining: 0, resetTime: Date.now() + 12_000, unavailable: false };
    const flooded = await beginPurchase(request(), gates);
    expect(flooded.ok).toBe(false);
    if (!flooded.ok) expect(flooded.response.status).toBe(429);
  });

  it("lets a route say how long the wait is", async () => {
    state.limit = { allowed: false, remaining: 0, resetTime: Date.now() + 12_000, unavailable: false };
    const begun = await beginPurchase(request(), {
      ...gates,
      copy: { rateLimited: (ms: number) => `Too many attempts. Try again in ${Math.ceil(ms / 1000)}s.` },
    });
    expect(begun.ok).toBe(false);
    if (begun.ok) return;
    expect((await begun.response.json()).error).toMatch(/Try again in \d+s\./);
  });

  it("stops a paced script at the hourly ceiling, and records why", async () => {
    state.velocity = { allowed: false, count: 31, limit: 30 };
    const begun = await beginPurchase(request(), gates);
    expect(begun.ok).toBe(false);
    if (begun.ok) return;
    expect(begun.response.status).toBe(429);
    expect(state.recorded).toHaveLength(1);
    expect(state.recorded[0]).toMatchObject({ kind: "purchase_velocity", severity: "warn" });
  });

  it("bounds the body, and rejects malformed JSON", async () => {
    const huge = await beginPurchase(request(undefined, { raw: JSON.stringify("x".repeat(9_000)) }), {
      ...gates,
      maxBodyBytes: 2_048,
    });
    expect(huge.ok).toBe(false);
    if (!huge.ok) expect(huge.response.status).toBe(413);

    const broken = await beginPurchase(request(undefined, { raw: "{not json" }), gates);
    expect(broken.ok).toBe(false);
    if (!broken.ok) expect(broken.response.status).toBe(400);
  });

  it("returns the caller and the parsed body when every gate is open", async () => {
    const begun = await beginPurchase<{ planSlug: string }>(request({ planSlug: "vn-ng" }), gates);
    expect(begun.ok).toBe(true);
    if (!begun.ok) return;
    expect(begun.user.id).toBe("user-1");
    expect(begun.body).toEqual({ planSlug: "vn-ng" });
  });
});

describe("what follows a purchase", () => {
  it("queues receipts and settles the referrer on every money path", async () => {
    await afterPurchase("user-1");
    expect(state.emails).toBe(1);
    expect(state.settled).toEqual(["user-1"]);
  });

  it("never turns a referral failure into a failed purchase", async () => {
    state.settleFails = true;
    await expect(afterPurchase("user-1")).resolves.toBeUndefined();
    expect(state.emails).toBe(1);
  });
});

describe("every money route walks the pipeline", () => {
  const root = join(process.cwd(), "src");
  const read = (path: string) => readFileSync(join(root, path), "utf8");

  const ROUTES = [
    "app/api/orders/route.ts",
    "app/api/orders/bulk/route.ts",
    "app/api/esim/purchase/route.ts",
    "app/api/accounts/purchase/route.ts",
    "app/api/gift-cards/order/route.ts",
    "app/api/gift-cards/purchase/route.ts",
    "app/api/boosts/order/route.ts",
  ];

  it("uses the shared gates instead of re-implementing them", () => {
    for (const route of ROUTES) {
      const source = read(route);
      expect(source, `${route} does not use beginPurchase`).toMatch(/beginPurchase[<(]/);
      // A route that still checks these itself has kept a second copy of the
      // prologue, which is exactly what drifts.
      expect(source, `${route} re-checks the origin itself`).not.toContain("isSameOriginMutation");
      expect(source, `${route} parses an unbounded body itself`).not.toContain("readJsonWithLimit");
      expect(source, `${route} reads supplier config for the gate itself`).not.toMatch(
        /financialActionsUnavailable\(\)\) return/,
      );
    }
  });

  it("keeps the idempotency key client-supplied everywhere it is used", () => {
    for (const route of ROUTES) {
      const source = read(route);
      if (!source.includes("requestId")) continue;
      expect(source, `${route} accepts a request id`).toMatch(/requestId/);
    }
  });
});
