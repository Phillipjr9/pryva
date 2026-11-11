import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_POOL_CONNECT_TIMEOUT_MS,
  DEFAULT_POOL_IDLE_TIMEOUT_MS,
  DEFAULT_POOL_MAX,
  guardPool,
  poolSettings,
} from "@/db/pool-settings";

/**
 * What the connection pool does when the database is busier than it should be.
 *
 * node-postgres' defaults wait forever for a connection and crash the process
 * when an idle one drops. Neither shows up until the day traffic arrives, which
 * is the worst day to find out, so both are pinned here.
 */

describe("poolSettings", () => {
  it("never waits forever for a connection", () => {
    const settings = poolSettings({});
    expect(settings.connectionTimeoutMillis).toBe(DEFAULT_POOL_CONNECT_TIMEOUT_MS);
    // Zero is the driver's spelling of "no timeout": a request that cannot get a
    // connection would hang until the platform killed the function.
    expect(settings.connectionTimeoutMillis).toBeGreaterThan(0);
  });

  it("waits long enough for a paused database to wake up", () => {
    // Aurora from the Vercel integration pauses when it is idle and holds a new
    // connection until it has resumed: about 15 seconds by AWS's figure, longer
    // after a day asleep, and AWS recommends a connection timeout of 30 seconds
    // or more. A shorter default fails the first request after every quiet
    // spell, which the driver's unlimited wait never did. See
    // `db-pool-wake.test.ts` for what the driver does on each side of the limit.
    expect(DEFAULT_POOL_CONNECT_TIMEOUT_MS).toBeGreaterThanOrEqual(30_000);
    // And it is still a limit: a minute at most, against the five the host
    // allows a request by default.
    expect(DEFAULT_POOL_CONNECT_TIMEOUT_MS).toBeLessThanOrEqual(60_000);
  });

  it("keeps the driver's size and idle timeout unless told otherwise", () => {
    expect(poolSettings({})).toEqual({
      max: DEFAULT_POOL_MAX,
      idleTimeoutMillis: DEFAULT_POOL_IDLE_TIMEOUT_MS,
      connectionTimeoutMillis: DEFAULT_POOL_CONNECT_TIMEOUT_MS,
    });
    expect(DEFAULT_POOL_MAX).toBe(10);
    expect(DEFAULT_POOL_IDLE_TIMEOUT_MS).toBe(10_000);
  });

  it("can be tuned from the environment without a code change", () => {
    expect(
      poolSettings({ PG_POOL_MAX: "4", PG_POOL_IDLE_TIMEOUT_MS: "5000", PG_POOL_CONNECT_TIMEOUT_MS: " 3000 " }),
    ).toEqual({ max: 4, idleTimeoutMillis: 5_000, connectionTimeoutMillis: 3_000 });
  });

  it.each([
    ["PG_POOL_MAX", "0"],
    ["PG_POOL_MAX", "-5"],
    ["PG_POOL_MAX", "ten"],
    ["PG_POOL_MAX", "1e3"],
    ["PG_POOL_MAX", "5000"],
    ["PG_POOL_MAX", ""],
    ["PG_POOL_IDLE_TIMEOUT_MS", "5"],
    ["PG_POOL_IDLE_TIMEOUT_MS", "forever"],
    // The one that matters most: nobody may switch the wait back to unbounded.
    ["PG_POOL_CONNECT_TIMEOUT_MS", "0"],
    ["PG_POOL_CONNECT_TIMEOUT_MS", "999999999"],
  ])("falls back to the default when %s is %j", (key, value) => {
    expect(poolSettings({ [key]: value })).toEqual(poolSettings({}));
  });
});

describe("guardPool", () => {
  it("turns a dropped idle connection into a log line instead of a crash", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const pool = new EventEmitter();

    // Without a listener this `emit` throws: an unhandled `error` event is an
    // uncaught exception, and that takes down every request on the instance.
    expect(() => new EventEmitter().emit("error", new Error("unhandled"))).toThrow("unhandled");

    expect(guardPool(pool)).toBe(pool);
    expect(() => pool.emit("error", new Error("Connection terminated unexpectedly"))).not.toThrow();
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0]?.join(" "))).toContain("Connection terminated unexpectedly");
    log.mockRestore();
  });

  it("logs the message only, never the error object and whatever it carries", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const pool = guardPool(new EventEmitter());
    const error = Object.assign(new Error("password authentication failed"), {
      connectionParameters: { password: "hunter2" },
    });

    pool.emit("error", error);

    expect(log.mock.calls[0]?.every((part) => typeof part === "string")).toBe(true);
    expect(JSON.stringify(log.mock.calls)).not.toContain("hunter2");
    log.mockRestore();
  });
});

/**
 * The settings only matter if both pools are actually built with them. The
 * driver is replaced by a recorder here: no socket is opened, and what is
 * asserted is what the application handed to `new Pool(...)`.
 */
const driver = vi.hoisted(() => ({
  created: [] as Array<{ options: Record<string, unknown>; listeners: string[] }>,
}));

vi.mock("pg", () => {
  class Pool {
    options: Record<string, unknown>;
    private readonly record: { options: Record<string, unknown>; listeners: string[] };
    constructor(options: Record<string, unknown> = {}) {
      this.options = options;
      this.record = { options, listeners: [] };
      driver.created.push(this.record);
    }
    on(event: string) {
      this.record.listeners.push(event);
      return this;
    }
  }
  return { Pool, default: { Pool } };
});

describe("both pools are built with the bounded settings", () => {
  const globalWithPool = globalThis as typeof globalThis & { __arenaNextJsPostgresqlPool?: unknown };

  beforeEach(() => {
    driver.created.length = 0;
    delete globalWithPool.__arenaNextJsPostgresqlPool;
    vi.resetModules();
  });

  afterEach(() => {
    delete globalWithPool.__arenaNextJsPostgresqlPool;
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("the connection-string pool", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://app:secret@db.internal:5432/pryva");
    vi.stubEnv("PG_POOL_MAX", "6");

    const { pool } = await import("@/db");

    expect(pool).not.toBeNull();
    expect(driver.created).toHaveLength(1);
    expect(driver.created[0].options).toMatchObject({
      connectionString: "postgres://app:secret@db.internal:5432/pryva",
      max: 6,
      idleTimeoutMillis: DEFAULT_POOL_IDLE_TIMEOUT_MS,
      connectionTimeoutMillis: DEFAULT_POOL_CONNECT_TIMEOUT_MS,
    });
    expect(driver.created[0].listeners).toContain("error");
  });

  it("the Aurora IAM pool", async () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("PGHOST", "cluster.example.rds.amazonaws.com");
    vi.stubEnv("PGUSER", "app");
    vi.stubEnv("AWS_REGION", "eu-west-1");
    vi.stubEnv("AWS_ROLE_ARN", "arn:aws:iam::123456789012:role/app");

    const { pool } = await import("@/db");

    expect(pool).not.toBeNull();
    expect(driver.created).toHaveLength(1);
    expect(driver.created[0].options).toMatchObject({
      host: "cluster.example.rds.amazonaws.com",
      max: DEFAULT_POOL_MAX,
      idleTimeoutMillis: DEFAULT_POOL_IDLE_TIMEOUT_MS,
      connectionTimeoutMillis: DEFAULT_POOL_CONNECT_TIMEOUT_MS,
    });
    // The password stays a function: a token is signed per connection.
    expect(typeof driver.created[0].options.password).toBe("function");
    expect(driver.created[0].listeners).toContain("error");
  });

  it("opens no pool at all when no database is configured", async () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("PGHOST", "");
    vi.stubEnv("PGUSER", "");
    vi.stubEnv("AWS_REGION", "");
    vi.stubEnv("AWS_ROLE_ARN", "");

    const { pool } = await import("@/db");

    expect(pool).toBeNull();
    expect(driver.created).toHaveLength(0);
  });
});
