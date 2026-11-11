import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import * as schema from "@/db/schema";

const mocks = vi.hoisted(() => ({
  db: undefined as unknown,
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("@/db", () => ({ get db() { return mocks.db; } }));
vi.mock("@/lib/platform/logger", () => ({ logger: mocks.log }));

let pg: PGlite;
let database: PgliteDatabase<typeof schema>;
let store: typeof import("@/lib/platform/shared-snapshot");

beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(await readFile("migrations/0045_shared_catalog_snapshots.sql", "utf8"));
  database = drizzle(pg, { schema });
  mocks.db = database;
  store = await import("@/lib/platform/shared-snapshot");
});

afterAll(async () => { await pg?.close(); });
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("DATABASE_URL", "postgres://embedded-test/db");
});

describe("shared complete catalogue snapshots", () => {
  it("coalesces concurrent cold reads across the PostgreSQL lease", async () => {
    let calls = 0;
    const refresh = vi.fn(async () => {
      calls++;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { value: { listings: ["a", "b"], version: calls }, checkedAt: new Date().toISOString() };
    });
    const reads = await Promise.all(Array.from({ length: 20 }, () => store.readSharedSnapshot({
      key: "test:concurrent", ttlMs: 60_000, refresh,
    })));

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(reads.every((result) => result.value.listings.length === 2)).toBe(true);
    expect(new Set(reads.map((result) => result.refreshedAt)).size).toBe(1);
    const rows = await database.select().from(schema.catalogSnapshots);
    expect(rows).toHaveLength(1);
    expect(rows[0].leaseOwner).toBeNull();
  });

  it("serves the last complete value while a stale refresh is in flight", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const refresh = vi.fn()
      .mockResolvedValueOnce({ value: { version: 1 }, checkedAt: new Date().toISOString() })
      .mockImplementationOnce(async () => {
        await gate;
        return { value: { version: 2 }, checkedAt: new Date().toISOString() };
      });
    const first = await store.readSharedSnapshot<{ version: number }>({ key: "test:background", ttlMs: 0, refresh });
    expect(first.value.version).toBe(1);
    const second = await store.readSharedSnapshot<{ version: number }>({ key: "test:background", ttlMs: 0, refresh });
    expect(second).toMatchObject({ value: { version: 1 }, stale: true });
    expect(refresh).toHaveBeenCalledTimes(2);
    release?.();
    await vi.waitFor(async () => {
      const current = await store.readSharedSnapshot<{ version: number }>({ key: "test:background", ttlMs: 60_000, refresh });
      expect(current.value.version).toBe(2);
    });
  });

  it("never replaces a good snapshot when a later supplier walk fails", async () => {
    const refresh = vi.fn()
      .mockResolvedValueOnce({ value: { listings: ["complete"] }, checkedAt: new Date().toISOString() })
      .mockRejectedValueOnce(new Error("supplier page 17 failed"));
    await store.readSharedSnapshot({ key: "test:failure", ttlMs: 0, refresh });
    const stale = await store.readSharedSnapshot({ key: "test:failure", ttlMs: 0, refresh });
    expect(stale).toMatchObject({ value: { listings: ["complete"] }, stale: true });
    await vi.waitFor(async () => {
      const rows = await database.select().from(schema.catalogSnapshots);
      const row = rows.find((item) => item.key === "test:failure");
      expect(row?.payload).toEqual({ listings: ["complete"] });
      expect(row?.leaseOwner).toBeNull();
    });
    const coolingDown = await store.readSharedSnapshot({ key: "test:failure", ttlMs: 0, refresh });
    expect(coolingDown.stale).toBe(true);
    expect(refresh).toHaveBeenCalledTimes(2);
    const again = await store.readSharedSnapshot({ key: "test:failure", ttlMs: 60_000, refresh });
    expect(again.value).toEqual({ listings: ["complete"] });
  });

  it("does not expose an initial partial result or cache the failure", async () => {
    const refresh = vi.fn().mockRejectedValue(new Error("incomplete"));
    await expect(store.readSharedSnapshot({ key: "test:cold-failure", ttlMs: 60_000, refresh }))
      .rejects.toBeInstanceOf(store.SnapshotUnavailableError);
    const rows = await database.select().from(schema.catalogSnapshots);
    const row = rows.find((item) => item.key === "test:cold-failure");
    expect(row?.payload).toBeNull();
    expect(row?.leaseOwner).toBeNull();

    refresh.mockResolvedValueOnce({ value: { complete: true }, checkedAt: new Date().toISOString() });
    const recovered = await store.readSharedSnapshot({ key: "test:cold-failure", ttlMs: 60_000, refresh });
    expect(recovered.value).toEqual({ complete: true });
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});
