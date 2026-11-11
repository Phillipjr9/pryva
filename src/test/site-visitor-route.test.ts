import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `/api/visitor` is what lets the public pages be prerendered: the header
 * asks it who the visitor is, from the browser, instead of the server reading the
 * session while it renders. That only helps if the endpoint is cheap for the
 * visitors a traffic spike is made of — people with no session at all — and safe
 * to call from a public page. These tests hold both.
 *
 * The real `getCurrentUser` runs here on purpose. Mocking it would prove the
 * route forwards a value; it would not prove that an anonymous visitor never
 * reaches the database, which is the whole point.
 */

const state = vi.hoisted(() => ({
  rows: [] as unknown[],
  selects: 0,
  fail: false,
  headers: new Headers(),
  cookies: new Map<string, string>(),
}));

vi.mock("@/db", () => ({
  db: {
    select: () => {
      state.selects += 1;
      if (state.fail) throw new Error("database unavailable");
      return {
        from: () => ({
          innerJoin: () => ({
            where: () => ({ limit: async () => state.rows }),
          }),
        }),
      };
    },
  },
}));

vi.mock("next/headers", () => ({
  headers: async () => state.headers,
  cookies: async () => ({
    get: (name: string) => (state.cookies.has(name) ? { name, value: state.cookies.get(name) } : undefined),
  }),
}));

import { GET } from "@/app/api/visitor/route";
import { SESSION_TOKENS_HEADER } from "@/lib/platform/session-cookies";

const account = {
  id: "0b2f6c1e-6a0e-4a53-9d0c-2f9f4f4f3c11",
  name: "Ada Obi",
  email: "ada@example.test",
  passwordHash: "salt:hash",
  walletBalance: 12_500,
  emailVerifiedAt: new Date("2026-01-01T00:00:00Z"),
  createdAt: new Date("2026-01-01T00:00:00Z"),
  failedLoginAttempts: 3,
};

beforeEach(() => {
  state.rows = [];
  state.selects = 0;
  state.fail = false;
  state.headers = new Headers();
  state.cookies = new Map();
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("GET /api/visitor", () => {
  it("answers a visitor with no session cookie without touching the database", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ user: null });
    // The visitors in a traffic spike are these. One query each would move the
    // spike from the application onto the database.
    expect(state.selects).toBe(0);
  });

  it("is never cacheable: the answer belongs to one browser", async () => {
    const response = await GET();
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("cache-control")).toContain("private");
  });

  it("returns only what the header renders for a signed-in visitor", async () => {
    state.cookies.set("pryva_session", "live-token");
    state.rows = [{ user: account }];

    const response = await GET();
    const body = (await response.json()) as Record<string, unknown>;

    // toEqual, not toMatchObject: an extra field here is a leak to every script
    // on a public page, so the exact shape is the assertion.
    expect(body).toEqual({ user: { name: "Ada Obi", walletBalance: 12_500 } });
    expect(JSON.stringify(body)).not.toContain("ada@example.test");
    expect(JSON.stringify(body)).not.toContain(account.id);
    expect(JSON.stringify(body)).not.toContain("salt:hash");
    expect(state.selects).toBe(1);
  });

  it("reads the copies the proxy forwards, not just the cookie Next kept", async () => {
    state.headers = new Headers({ [SESSION_TOKENS_HEADER]: "live-token" });
    state.rows = [{ user: account }];

    expect(await (await GET()).json()).toEqual({ user: { name: "Ada Obi", walletBalance: 12_500 } });
  });

  it("treats a cookie that matches no session as signed out", async () => {
    state.cookies.set("pryva_session", "stale-token");
    state.rows = [];

    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ user: null });
  });

  it("answers signed out, not an error, when the session store cannot be reached", async () => {
    state.cookies.set("pryva_session", "live-token");
    state.fail = true;

    const response = await GET();

    // The page is already on screen as the signed-out version. A 500 here would
    // only add a console error to a page that is otherwise working.
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ user: null });
  });
});
