import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";

const mocks = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("@/db", () => ({ get db() { return mocks.db; } }));

import { createRateLimiter, resetRateLimit } from "@/lib/rate-limit";
import { checkAuthRateLimit } from "@/lib/auth-rate-limit";

let pg: PGlite;
let database: ReturnType<typeof drizzle>;

beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(await readFile("migrations/0002_shared_rate_limits.sql", "utf8"));
  database = drizzle(pg);
}, 30_000);
afterAll(async () => { await pg.close(); });
beforeEach(async () => {
  vi.stubEnv("DATABASE_URL", "postgres://embedded-test/db");
  mocks.db = database;
  await pg.exec("TRUNCATE rate_limit_buckets");
});
afterEach(() => vi.unstubAllEnvs());

describe("shared PostgreSQL rate limits", () => {
  it("shares and atomically increments a bounded budget across limiter instances", async () => {
    const a = createRateLimiter({ windowMs: 60_000, maxRequests: 5 });
    const b = createRateLimiter({ windowMs: 60_000, maxRequests: 5 });
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => (i % 2 ? a : b)("login:key:person@example.com")));
    expect(results.filter((result) => result.allowed)).toHaveLength(5);
    expect(results.every((result) => !result.unavailable)).toBe(true);
    const records = await pg.query<{ key: string; count: number }>("SELECT key, count FROM rate_limit_buckets");
    expect(records.rows).toEqual([{ key: createHash("sha256").update("login:key:person@example.com").digest("hex"), count: 6 }]);
  });

  it("resets shared keys and starts a fresh window after expiry", async () => {
    const limiter = createRateLimiter({ windowMs: 60_000, maxRequests: 1 });
    expect((await limiter("key")).allowed).toBe(true);
    expect((await limiter("key")).allowed).toBe(false);
    await resetRateLimit("key");
    expect((await limiter("key")).allowed).toBe(true);
    await pg.exec("UPDATE rate_limit_buckets SET reset_at = now() - interval '1 second'");
    expect((await limiter("key")).allowed).toBe(true);
    expect((await limiter("key")).allowed).toBe(false);
  });

  it("fails closed rather than falling back to process memory when the store fails", async () => {
    mocks.db = { execute: vi.fn().mockRejectedValue(new Error("private connection error")) };
    const limiter = createRateLimiter({ windowMs: 60_000, maxRequests: 5 });
    expect(await limiter("key")).toMatchObject({ allowed: false, unavailable: true });
    const response = await checkAuthRateLimit(new Request("https://pryva.test/api/auth/login", {
      method: "POST", headers: { "x-forwarded-for": "203.0.113.5" },
    }), "login", "person@example.com");
    expect(response?.status).toBe(503);
    expect(await response?.text()).not.toContain("private connection error");
  });
});
