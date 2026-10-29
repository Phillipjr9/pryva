import { beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

// No DATABASE_URL: these assertions cover the guards that must reject a request
// before anything touches the database, so the preview shim is enough.
process.env.DATABASE_URL = "";

type Handler = (request: NextRequest) => Promise<Response>;
let forgot: Handler;
let reset: Handler;

beforeAll(async () => {
  forgot = (await import("@/app/api/auth/forgot/route")).POST as unknown as Handler;
  reset = (await import("@/app/api/auth/reset/route")).POST as unknown as Handler;
});

function build(path: string, init: { body?: unknown; origin?: string; site?: string; json?: boolean }) {
  const headers = new Headers({ host: "pryva.test", "x-forwarded-proto": "https" });
  if (init.json !== false) headers.set("content-type", "application/json");
  if (init.origin) headers.set("origin", init.origin);
  if (init.site) headers.set("sec-fetch-site", init.site);
  return new NextRequest(`https://pryva.test${path}`, {
    method: "POST",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

describe("password reset endpoints", () => {
  it("refuses a cross-origin request before doing any work", async () => {
    const response = await forgot(build("/api/auth/forgot", {
      body: { email: "victim@pryva.ng" },
      origin: "https://evil.example",
      site: "cross-site",
    }));
    expect(response.status).toBe(403);
  });

  it("accepts a same-origin request past the origin guard", async () => {
    const response = await forgot(build("/api/auth/forgot", {
      body: { email: "" },
      origin: "https://pryva.test",
      site: "same-origin",
    }));
    // 400 for the empty address, not 403: the origin check passed.
    expect(response.status).toBe(400);
  });

  it("refuses a non-JSON request", async () => {
    const response = await forgot(build("/api/auth/forgot", { body: {}, json: false }));
    expect(response.status).toBe(415);
  });

  it("requires an email address", async () => {
    const response = await forgot(build("/api/auth/forgot", { body: {} }));
    expect(response.status).toBe(400);
  });

  it("requires both a token and a password to reset", async () => {
    const response = await reset(build("/api/auth/reset", { body: { password: "only-a-password" } }));
    expect(response.status).toBe(400);
  });

  it("refuses a cross-origin reset", async () => {
    const response = await reset(build("/api/auth/reset", {
      body: { token: "x".repeat(40), password: "a-new-password" },
      origin: "https://evil.example",
      site: "cross-site",
    }));
    expect(response.status).toBe(403);
  });
});
