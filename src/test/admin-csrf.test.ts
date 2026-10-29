import { beforeAll, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * The admin mutations are the highest-privilege endpoints in the app: they
 * approve withdrawals, issue refunds and edit accounts, and they authenticate
 * with a cookie session. That makes them a CSRF target, so each one rejects a
 * cross-origin mutation before it even looks at authorization.
 *
 * Every case is paired with a same-origin control. Without the control a guard
 * that returned 403 unconditionally would pass every assertion here.
 */

// Some handlers take a route context as well as the request; declaring both lets
// one type cover every route, and passing a context keeps the two-argument ones
// from throwing before the origin check can answer.
type Handler = (request: never, context: { params: Promise<{ id: string }> }) => Promise<Response>;
const CONTEXT = { params: Promise.resolve({ id: "x" }) };

const routes: Array<{ name: string; method: string; url: string; call: Handler }> = [];

beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", "");
  const fulfilment = await import("@/app/api/admin/fulfilment/route");
  const messages = await import("@/app/api/admin/messages/route");
  const refunds = await import("@/app/api/admin/refunds/route");
  const withdrawals = await import("@/app/api/admin/withdrawals/route");
  const userEdit = await import("@/app/api/admin/users/[id]/route");

  routes.push(
    { name: "admin/fulfilment", method: "POST", url: "https://pryva.test/api/admin/fulfilment", call: fulfilment.POST as Handler },
    { name: "admin/messages", method: "PATCH", url: "https://pryva.test/api/admin/messages", call: messages.PATCH as Handler },
    { name: "admin/refunds", method: "POST", url: "https://pryva.test/api/admin/refunds", call: refunds.POST as Handler },
    { name: "admin/withdrawals", method: "PUT", url: "https://pryva.test/api/admin/withdrawals", call: withdrawals.PUT as Handler },
    { name: "admin/users/[id]", method: "PUT", url: "https://pryva.test/api/admin/users/x", call: userEdit.PUT as Handler },
  );
});

function build(url: string, method: string, kind: "cross-site" | "same-origin") {
  const headers: Record<string, string> = {
    host: "pryva.test",
    "x-forwarded-proto": "https",
    "content-type": "application/json",
  };
  if (kind === "cross-site") {
    headers.origin = "https://evil.example";
    headers["sec-fetch-site"] = "cross-site";
  } else {
    headers.origin = "https://pryva.test";
    headers["sec-fetch-site"] = "same-origin";
  }
  return new NextRequest(url, { method, headers, body: "{}" });
}

describe("admin mutations reject cross-origin callers", () => {
  it.each([0, 1, 2, 3, 4])("blocks a cross-site request to %s", async (index) => {
    const route = routes[index];
    expect(route, "routes are registered in beforeAll").toBeDefined();
    const response = await route.call(build(route.url, route.method, "cross-site") as never, CONTEXT);
    expect(response.status).toBe(403);
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    expect(body.error).toBe("Invalid origin");
  });

  it.each([0, 1, 2, 3, 4])("does not reject a same-origin request to %s on origin grounds", async (index) => {
    const route = routes[index];
    expect(route, "routes are registered in beforeAll").toBeDefined();
    const response = await route.call(build(route.url, route.method, "same-origin") as never, CONTEXT);
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    // It may still fail -- these are unauthenticated calls -- but it must fail on
    // authorization or validation, never on origin. Asserting the reason rather
    // than the status keeps this control meaningful for routes that use 403 for
    // their own "not yours" answers.
    expect(body.error).not.toBe("Invalid origin");
  });
});
