/**
 * How the connection pool behaves when the database is busier than it should be.
 *
 * This module deliberately imports nothing at runtime, so the numbers can be
 * tested without constructing a pool and read without loading a driver.
 *
 * ## What was wrong with the defaults
 *
 * Both pools were created with node-postgres' defaults, and two of those defaults
 * are the wrong answer under load:
 *
 *   * **No connection timeout.** `connectionTimeoutMillis` defaults to "wait
 *     forever". When every connection is in use — or the database has no slots
 *     left because a traffic spike started more application instances than it
 *     can serve — a request does not fail, it hangs until the platform kills the
 *     function. Hung requests hold their place in the queue, so the outage
 *     outlives the spike that caused it. A bounded wait turns that into an error
 *     the route can answer, and frees the queue for requests that can succeed.
 *   * **No error listener.** A pooled connection that drops while idle (a
 *     failover, a network reset, the database closing it) makes the pool emit
 *     `error`. An `error` event with nobody listening is an uncaught exception in
 *     Node, which takes the whole instance down — and every request it was
 *     serving with it. `guardPool` listens, logs, and lets the pool replace the
 *     connection, which is all that needed to happen.
 *
 * ## The numbers
 *
 * `max` and the idle timeout keep the values the driver already used, so nothing
 * about a healthy deployment changes; they are spelled out so they can be tuned
 * from the environment without a code change. The instance count is the
 * platform's decision, not ours, and the database's connection limit is shared
 * by all of them: `instances x PG_POOL_MAX` is the number that has to stay under
 * it. Lower `PG_POOL_MAX` when the database reports too many connections; a
 * bigger database only moves the point at which the same thing happens.
 *
 * The connect wait is the one limit that is new, and it is sized for a database
 * that is asleep, not for one that is busy: see `DEFAULT_POOL_CONNECT_TIMEOUT_MS`.
 */

/** Connections one application instance may hold. node-postgres' own default. */
export const DEFAULT_POOL_MAX = 10;

/** How long an unused connection is kept before it is closed. The driver's default. */
export const DEFAULT_POOL_IDLE_TIMEOUT_MS = 10_000;

/**
 * How long a query waits for a connection before failing.
 *
 * Long on purpose, because the production database sleeps. Aurora created
 * through the Vercel AWS integration starts with a minimum capacity of zero: it
 * pauses after five minutes without a connection, and a connection made while it
 * is paused is held until it has resumed. AWS gives that as "approximately 15
 * seconds", "30 seconds or longer" after more than a day paused, and recommends
 * connection timeouts of 30 seconds or more for that case:
 * https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-serverless-v2-auto-pause.html
 *
 * A limit shorter than the wake-up does not make the first request after a quiet
 * spell faster. It makes it fail, where the driver's unlimited wait let it
 * succeed slowly. Thirty seconds lets that request through, and still ends a
 * wait that would otherwise last until the host gave up on the request.
 *
 * Lower it (`PG_POOL_CONNECT_TIMEOUT_MS`) only for a database that cannot pause.
 */
export const DEFAULT_POOL_CONNECT_TIMEOUT_MS = 30_000;

export type PoolSettings = {
  max: number;
  idleTimeoutMillis: number;
  connectionTimeoutMillis: number;
};

/** A whole number within bounds, or the fallback. Junk never reaches the driver. */
function boundedInteger(raw: string | undefined, fallback: number, min: number, max: number): number {
  const trimmed = raw?.trim();
  if (!trimmed || !/^\d{1,7}$/.test(trimmed)) return fallback;
  const value = Number(trimmed);
  return value >= min && value <= max ? value : fallback;
}

export function poolSettings(env: Record<string, string | undefined> = process.env): PoolSettings {
  return {
    max: boundedInteger(env.PG_POOL_MAX, DEFAULT_POOL_MAX, 1, 100),
    idleTimeoutMillis: boundedInteger(env.PG_POOL_IDLE_TIMEOUT_MS, DEFAULT_POOL_IDLE_TIMEOUT_MS, 1_000, 600_000),
    // Zero would mean "wait forever" to the driver, which is the behaviour this
    // module exists to remove, so the floor is one second rather than zero.
    connectionTimeoutMillis: boundedInteger(
      env.PG_POOL_CONNECT_TIMEOUT_MS,
      DEFAULT_POOL_CONNECT_TIMEOUT_MS,
      1_000,
      120_000,
    ),
  };
}

/** The part of a pool this module needs; node-postgres' `Pool` satisfies it. */
type ErrorEmitter = { on(event: "error", listener: (error: Error) => void): unknown };

/**
 * Keep a dropped idle connection from crashing the process.
 *
 * The pool has already discarded the connection by the time this runs, and the
 * next query opens a new one. Only the message is logged: a driver error can
 * carry connection parameters, and those do not belong in a log line.
 */
export function guardPool<T extends ErrorEmitter>(pool: T): T {
  pool.on("error", (error) => {
    console.error("[db] idle connection dropped; the pool will replace it:", error?.message ?? "unknown error");
  });
  return pool;
}
