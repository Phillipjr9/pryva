import net, { type AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { poolSettings } from "@/db/pool-settings";

/**
 * What the connect limit means to the driver, measured on a real socket.
 *
 * The production database (Aurora from the Vercel AWS integration) pauses when
 * it is idle. To a client a paused database is one that accepts the connection
 * and answers late, once it has resumed. The first version of the pool limit was
 * ten seconds against a wake-up of about fifteen: every first request after a
 * quiet spell would have failed, where the driver's unlimited wait had let it
 * succeed slowly. Nothing caught it, because no test had a slow database in it.
 *
 * This file has one. The server below speaks just enough of the PostgreSQL
 * protocol to complete a connection, after a delay. The times are scaled down
 * (400 ms stands in for the wake-up); the driver has no notion of scale.
 */

const WAKE_UP_MS = 400;

const servers: net.Server[] = [];
const sockets = new Set<net.Socket>();
const pools: Pool[] = [];

/** Accepts a connection and answers the startup packet only after `answerAfterMs`. */
async function sleepyDatabase(answerAfterMs: number): Promise<number> {
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("error", () => undefined);
    socket.once("close", () => sockets.delete(socket));
    socket.once("data", () => {
      const timer = setTimeout(() => {
        // AuthenticationOk, then ReadyForQuery: the driver now reports "connected".
        const authenticationOk = Buffer.from([0x52, 0, 0, 0, 8, 0, 0, 0, 0]);
        const readyForQuery = Buffer.from([0x5a, 0, 0, 0, 5, 0x49]);
        if (!socket.destroyed) socket.write(Buffer.concat([authenticationOk, readyForQuery]));
      }, answerAfterMs);
      socket.once("close", () => clearTimeout(timer));
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return (server.address() as AddressInfo).port;
}

function poolFor(port: number, connectionTimeoutMillis: number, max?: number): Pool {
  const pool = new Pool({
    host: "127.0.0.1",
    port,
    user: "app",
    database: "pryva",
    ssl: false,
    ...poolSettings({}),
    ...(max ? { max } : {}),
    connectionTimeoutMillis,
  });
  // The application's pools have a listener too (`guardPool`); without one a
  // socket torn down by the timeout would be an uncaught exception here.
  pool.on("error", () => undefined);
  pools.push(pool);
  return pool;
}

afterEach(async () => {
  await Promise.all(pools.splice(0).map((pool) => pool.end().catch(() => undefined)));
  // A listening server only closes once its connections have gone.
  for (const socket of sockets) socket.destroy();
  await Promise.all(
    servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
});

describe("a database that is slow to wake", () => {
  it("fails the request when the limit is shorter than the wake-up", async () => {
    const pool = poolFor(await sleepyDatabase(WAKE_UP_MS), WAKE_UP_MS / 4);

    await expect(pool.connect()).rejects.toThrow("Connection terminated due to connection timeout");
  });

  it("is waited for, and connects, when the limit is longer than the wake-up", async () => {
    const pool = poolFor(await sleepyDatabase(WAKE_UP_MS), WAKE_UP_MS * 10);

    const started = Date.now();
    const client = await pool.connect();
    const waited = Date.now() - started;
    client.release(true);

    // It waited for the database rather than giving up or answering early.
    expect(waited).toBeGreaterThanOrEqual(WAKE_UP_MS - 50);
    expect(waited).toBeLessThan(WAKE_UP_MS * 10);
  });

  it("reports a busy pool differently from a database that did not answer", async () => {
    // One connection, already in use: the second caller waits for the pool, not
    // for the database. OPERATIONS.txt tells an operator to read the two
    // messages differently, so the difference is pinned.
    const pool = poolFor(await sleepyDatabase(0), 150, 1);
    const held = await pool.connect();

    await expect(pool.connect()).rejects.toThrow("timeout exceeded when trying to connect");

    held.release(true);
  });
});
