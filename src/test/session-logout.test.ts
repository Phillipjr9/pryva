import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

const mocks = vi.hoisted(() => ({ cookies: vi.fn(), headers: vi.fn(), insert: vi.fn(), remove: vi.fn(), set: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: mocks.cookies, headers: mocks.headers }));
vi.mock("@/db", () => ({ db: { insert: () => ({ values: mocks.insert }), delete: () => ({ where: mocks.remove }) } }));
import { createSession, destroySession, requestIsSecure } from "@/lib/auth";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.remove.mockResolvedValue(undefined);
  mocks.insert.mockResolvedValue(undefined);
  mocks.headers.mockResolvedValue(new Headers({ host: "pryva.example:8443" }));
});

afterEach(() => vi.unstubAllEnvs());

describe("session logout", () => {
  it("revokes both cookie tokens when they are different", async () => {
    mocks.cookies.mockResolvedValue({
      get: (name: string) => ({ value: name === "pryva_session" ? "token-one" : "token-two" }),
      set: mocks.set,
    });
    await destroySession();
    const dialect = new PgDialect();
    const deleted = mocks.remove.mock.calls.map(([condition]) => dialect.sqlToQuery(condition as SQL).params[0]);
    expect(deleted).toEqual(["token-one", "token-two"]);
    expect(mocks.set).toHaveBeenCalledTimes(2);
    expect(mocks.set.mock.calls[0][2]).toMatchObject({ maxAge: 0, secure: true });
  });

  it("issues and removes partitioned preview sessions for iframe fetches with same-origin metadata", async () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("E2B_SANDBOX_ID", "abc123");
    const headers = new Headers({ host: "3100-abc123.e2b.app", "x-forwarded-proto": "http", "sec-fetch-site": "same-origin", "sec-fetch-dest": "empty" });
    mocks.headers.mockResolvedValue(headers);
    mocks.cookies.mockResolvedValue({ get: () => undefined, set: mocks.set });
    const request = new Request("http://internal:3100/api/auth/login", { method: "POST", headers });
    await createSession("preview-user", request);
    expect(mocks.set.mock.calls[0][0]).toBe("pryva_session");
    expect(mocks.set.mock.calls[0][2]).toMatchObject({ httpOnly: true, secure: true, sameSite: "none", partitioned: true });
    expect(mocks.set.mock.calls[1][0]).toBe("pryva_session_3p");
    expect(mocks.set.mock.calls[1][2]).toMatchObject({ secure: true, sameSite: "lax" });
    mocks.set.mockClear();
    await destroySession();
    expect(mocks.set.mock.calls[0][2]).toMatchObject({ secure: true, sameSite: "none", partitioned: true, maxAge: 0 });
  });

  it("does not apply preview cookie rules to persistent deployments", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://configured/db");
    vi.stubEnv("E2B_SANDBOX_ID", "abc123");
    mocks.cookies.mockResolvedValue({ set: mocks.set });
    const request = new Request("http://internal:3100/api/auth/login", { method: "POST", headers: { host: "3100-abc123.e2b.app", "x-forwarded-proto": "http", "sec-fetch-site": "same-origin", "sec-fetch-dest": "empty" } });
    await createSession("persistent-user", request);
    expect(mocks.set).toHaveBeenCalledTimes(1);
    expect(mocks.set.mock.calls[0][2]).toMatchObject({ secure: false, sameSite: "lax" });
    expect(mocks.set.mock.calls[0][2]).not.toHaveProperty("partitioned");
  });

  it("uses secure cookies for this sandbox even if the internal proxy hop says HTTP", async () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("E2B_SANDBOX_ID", "abc123");
    mocks.headers.mockResolvedValue(new Headers({ host: "3100-abc123.e2b.app", "x-forwarded-proto": "http" }));
    expect(await requestIsSecure()).toBe(true);
    vi.stubEnv("DATABASE_URL", "postgres://configured/db");
    expect(await requestIsSecure()).toBe(false);
  });

  it("uses secure cookies for a public host with a port but not local HTTP", async () => {
    expect(await requestIsSecure()).toBe(true);
    mocks.headers.mockResolvedValue(new Headers({ host: "localhost:3000" }));
    expect(await requestIsSecure()).toBe(false);
    mocks.headers.mockResolvedValue(new Headers({ host: "localhost:3000", "x-forwarded-proto": "https" }));
    expect(await requestIsSecure()).toBe(true);
  });
});
