import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";

const mocks = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("@/db", () => ({ get db() { return mocks.db; } }));

import { createRateLimiter, releaseRateLimit, resetRateLimit } from "@/lib/rate-limit";
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

  /**
   * Giving a slot back exists for one situation: an attempt that failed for a
   * reason that cost nothing. It must not become a way to exceed the limit — so it
   * only ever decrements a live bucket, and can never take a count below zero.
   *
   * It also cannot undo a *denial*: the store clamps at `max + 1` when it refuses,
   * so one refusal leaves a unit that a single release does not clear. That is why
   * the release happens on the failure itself, before anybody is ever refused —
   * three broken attempts stay three free attempts instead of becoming a lockout.
   */
  it("gives a failed attempt back, so a broken feature cannot lock a customer out", async () => {
    const limiter = createRateLimiter({ windowMs: 60_000, maxRequests: 3 });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect((await limiter("inbox")).allowed).toBe(true);
      await releaseRateLimit("inbox");
    }

    // Every attempt that failed has been returned, so the budget is still whole.
    expect((await limiter("inbox")).allowed).toBe(true);
    const [row] = (await pg.query<{ count: number }>("SELECT count FROM rate_limit_buckets")).rows;
    expect(row.count).toBe(1);
  });

  it("never releases below zero and leaves an expired window alone", async () => {
    await releaseRateLimit("never-used");
    expect((await pg.query("SELECT count FROM rate_limit_buckets WHERE count < 0")).rows).toEqual([]);

    const limiter = createRateLimiter({ windowMs: 60_000, maxRequests: 2 });
    await limiter("expired");
    await pg.exec("UPDATE rate_limit_buckets SET reset_at = now() - interval '1 second'");
    await releaseRateLimit("expired");
    const [row] = (await pg.query<{ count: number }>("SELECT count FROM rate_limit_buckets")).rows;
    expect(row.count).toBe(1);
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
