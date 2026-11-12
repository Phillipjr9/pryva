import "server-only";

import { randomUUID } from "node:crypto";
import { waitUntil } from "@vercel/functions";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { persistentDatabaseConfigured } from "@/lib/platform/database-config";
import { logger } from "@/lib/platform/logger";

/**
 * A complete, immutable value shared by every application instance.
 *
 * The database row is both the last-known-good copy and a short refresh lease.
 * A refresh never overwrites the good value until the whole supplier walk has
 * succeeded. This deliberately uses PostgreSQL rather than Next's fetch cache:
 * catalogue reads are no-store and all instances must see the same pagination.
 */
export type SharedSnapshot<T> = {
  value: T;
  refreshedAt: string;
  /** Expired but still complete. Safe to browse; checkout remains live. */
  stale: boolean;
};

type Refresh<T> = () => Promise<{ value: T; checkedAt: string }>;
type LocalEntry = {
  snapshot: SharedSnapshot<unknown> | null;
  pending: Promise<SharedSnapshot<unknown>> | null;
};
const localEntries = new Map<string, LocalEntry>();
/** Emergency copy used only if PostgreSQL itself cannot be read. */
const lastGood = new Map<string, SharedSnapshot<unknown>>();

export class SnapshotUnavailableError extends Error {
  constructor(message = "The catalogue is temporarily unavailable") {
    super(message);
    this.name = "SnapshotUnavailableError";
  }
}

export function clearLocalSnapshots(): void {
  localEntries.clear();
  lastGood.clear();
}

function fresh<T>(snapshot: SharedSnapshot<T>, ttlMs: number): SharedSnapshot<T> {
  return { ...snapshot, stale: Date.now() - Date.parse(snapshot.refreshedAt) >= ttlMs };
}

function remember<T>(key: string, snapshot: SharedSnapshot<T>): SharedSnapshot<T> {
  lastGood.set(key, snapshot as SharedSnapshot<unknown>);
  return snapshot;
}

async function localSnapshot<T>(
  key: string,
  ttlMs: number,
  refresh: Refresh<T>,
): Promise<SharedSnapshot<T>> {
  const entry = localEntries.get(key) ?? { snapshot: null, pending: null };
  localEntries.set(key, entry);
  if (entry.snapshot && !fresh(entry.snapshot, ttlMs).stale) return entry.snapshot as SharedSnapshot<T>;
  if (entry.pending) {
    // A warm snapshot remains browsable while a refresh is already running.
    // Only a cold read must wait for that in-flight publication.
    return entry.snapshot ? { ...entry.snapshot as SharedSnapshot<T>, stale: true } : entry.pending as Promise<SharedSnapshot<T>>;
  }

  const previous = entry.snapshot as SharedSnapshot<T> | null;
  const pending = refresh().then(({ value }) => {
    const snapshot = remember(key, { value, refreshedAt: new Date().toISOString(), stale: false });
    entry.snapshot = snapshot;
    return snapshot;
  }).catch((error: unknown) => {
    if (previous) return { ...previous, stale: true };
    logger.warn("Initial snapshot refresh failed", { key, error: error instanceof Error ? error.message : "unknown" });
    throw new SnapshotUnavailableError();
  }).finally(() => {
    entry.pending = null;
  });
  entry.pending = pending as Promise<SharedSnapshot<unknown>>;

  // Once a good copy exists, shoppers never wait behind a supplier crawl.
  if (previous) {
    waitUntil(pending.catch((error: unknown) => {
      logger.warn("Background snapshot refresh failed", { key, error: error instanceof Error ? error.message : "unknown" });
    }));
    return { ...previous, stale: true };
  }
  return pending as Promise<SharedSnapshot<T>>;
}

type SnapshotRow = {
  payload: unknown;
  checked_at: string | Date | null;
  refreshed_at: string | Date | null;
};

async function readRow(key: string): Promise<SnapshotRow | null> {
  const result = await db.execute(sql`
    SELECT payload, checked_at, refreshed_at
    FROM catalog_snapshots WHERE key = ${key}
  `);
  return (result as unknown as { rows: SnapshotRow[] }).rows[0] ?? null;
}

function decodeRow<T>(row: SnapshotRow | null): SharedSnapshot<T> | null {
  if (!row?.payload || !row.refreshed_at) return null;
  const refreshedAt = new Date(row.refreshed_at).toISOString();
  return { value: row.payload as T, refreshedAt, stale: false };
}

async function acquireLease(key: string, owner: string, leaseMs: number, ttlMs: number): Promise<boolean> {
  const result = await db.execute(sql`
    INSERT INTO catalog_snapshots (key, lease_owner, lease_expires_at)
    VALUES (${key}, ${owner}, now() + ${leaseMs} * interval '1 millisecond')
    ON CONFLICT (key) DO UPDATE SET
      lease_owner = EXCLUDED.lease_owner,
      lease_expires_at = EXCLUDED.lease_expires_at
    WHERE (catalog_snapshots.lease_expires_at IS NULL
       OR catalog_snapshots.lease_expires_at <= now())
      AND (catalog_snapshots.refreshed_at IS NULL
       OR catalog_snapshots.refreshed_at <= now() - ${ttlMs} * interval '1 millisecond')
    RETURNING key
  `);
  return (result as unknown as { rows: unknown[] }).rows.length === 1;
}

async function publish<T>(key: string, owner: string, value: T, checkedAt: string): Promise<string | null> {
  const result = await db.execute(sql`
    UPDATE catalog_snapshots SET
      payload = ${JSON.stringify(value)}::jsonb,
      checked_at = ${checkedAt}::timestamptz,
      refreshed_at = now(),
      lease_owner = NULL,
      lease_expires_at = NULL
    WHERE key = ${key} AND lease_owner = ${owner}
    RETURNING refreshed_at
  `);
  const row = (result as unknown as { rows: { refreshed_at: string | Date }[] }).rows[0];
  return row ? new Date(row.refreshed_at).toISOString() : null;
}

async function releaseLease(key: string, owner: string, failureCooldown = false): Promise<void> {
  await db.execute(sql`
    UPDATE catalog_snapshots SET
      lease_owner = NULL,
      lease_expires_at = CASE WHEN ${failureCooldown}
        THEN now() + interval '30 seconds' ELSE NULL END
    WHERE key = ${key} AND lease_owner = ${owner}
  `);
}

async function persistentRefresh<T>(
  key: string,
  owner: string,
  leaseMs: number,
  refresh: Refresh<T>,
  hadGoodSnapshot: boolean,
): Promise<SharedSnapshot<T>> {
  // Supplier walks can outlive a single serverless invocation's unlucky delay.
  // Heartbeat ownership prevents a second instance starting a duplicate crawl.
  const heartbeat = setInterval(() => {
    void db.execute(sql`
      UPDATE catalog_snapshots
      SET lease_expires_at = now() + ${leaseMs} * interval '1 millisecond'
      WHERE key = ${key} AND lease_owner = ${owner}
    `).catch(() => undefined);
  }, Math.max(1_000, Math.floor(leaseMs / 3)));
  heartbeat.unref();
  let published = false;
  try {
    const { value, checkedAt } = await refresh();
    if (!Number.isFinite(Date.parse(checkedAt))) throw new Error("Snapshot returned an invalid timestamp");
    const refreshedAt = await publish(key, owner, value, checkedAt);
    if (!refreshedAt) throw new SnapshotUnavailableError("Catalogue refresh ownership expired");
    published = true;
    return remember(key, { value, refreshedAt, stale: false });
  } finally {
    clearInterval(heartbeat);
    // A failed warm refresh gets a 30-second retry cooldown. Without it, every
    // shopper arriving during an outage could immediately start another crawl.
    await releaseLease(key, owner, !published && hadGoodSnapshot).catch(() => undefined);
  }
}

type SnapshotOptions<T> = {
  key: string; ttlMs: number; leaseMs?: number; refresh: Refresh<T>;
  /** Only for callers with an independent safe fallback when another instance owns a cold lease. */
  skipColdWait?: boolean;
};
const sharedReads = new Map<string, Promise<SharedSnapshot<unknown>>>();

/** One database/lease waiter per scope per instance, not one per shopper. */
export async function readSharedSnapshot<T>(options: SnapshotOptions<T>): Promise<SharedSnapshot<T>> {
  const scope = `${options.key}:${options.ttlMs}:${options.leaseMs ?? 120_000}:${options.skipColdWait === true}`;
  const pending = sharedReads.get(scope);
  if (pending) return pending as Promise<SharedSnapshot<T>>;
  const read = readSharedSnapshotOnce(options).finally(() => {
    if (sharedReads.get(scope) === read) sharedReads.delete(scope);
  });
  sharedReads.set(scope, read as Promise<SharedSnapshot<unknown>>);
  return read;
}

async function readSharedSnapshotOnce<T>(options: SnapshotOptions<T>): Promise<SharedSnapshot<T>> {
  const { key, ttlMs, refresh } = options;
  const leaseMs = options.leaseMs ?? 120_000;
  if (!/^[a-z0-9:_-]{1,120}$/i.test(key)) throw new Error("Invalid snapshot key");
  if (!persistentDatabaseConfigured()) return localSnapshot(key, ttlMs, refresh);

  let current: SharedSnapshot<T> | null;
  try {
    current = decodeRow<T>(await readRow(key));
  } catch (error) {
    const emergency = lastGood.get(key) as SharedSnapshot<T> | undefined;
    if (emergency) return { ...emergency, stale: true };
    logger.error("Shared snapshot store unavailable", { key, error: error instanceof Error ? error.message : "unknown" });
    throw new SnapshotUnavailableError();
  }
  if (current) remember(key, current);
  if (current && !fresh(current, ttlMs).stale) return current;

  const owner = randomUUID();
  let acquired = false;
  try {
    acquired = await acquireLease(key, owner, leaseMs, ttlMs);
  } catch (error) {
    if (current) return { ...current, stale: true };
    throw new SnapshotUnavailableError();
  }

  if (acquired) {
    const pending = persistentRefresh(key, owner, leaseMs, refresh, current !== null);
    if (current) {
      waitUntil(pending.catch((error: unknown) => {
        logger.warn("Background shared snapshot refresh failed", { key, error: error instanceof Error ? error.message : "unknown" });
      }));
      return { ...current, stale: true };
    }
    try {
      return await pending;
    } catch (error) {
      logger.warn("Initial shared snapshot refresh failed", { key, error: error instanceof Error ? error.message : "unknown" });
      throw new SnapshotUnavailableError();
    }
  }

  if (current) {
    // The lease may have been refused because another instance just published.
    // Re-read once so this request returns that fresh value, not its stale read.
    try {
      const latest = decodeRow<T>(await readRow(key));
      if (latest) return fresh(remember(key, latest), ttlMs);
    } catch {
      // The previously read complete value is still safer than an empty page.
    }
    return { ...current, stale: true };
  }

  // An explicitly supplied alternative can be used without waiting for an
  // empty leased row. Re-read once in case a complete value was just published.
  if (options.skipColdWait) {
    try {
      const latest = decodeRow<T>(await readRow(key));
      if (latest) return fresh(remember(key, latest), ttlMs);
    } catch { /* The caller will use its independent fallback. */ }
    throw new SnapshotUnavailableError();
  }

  // Cold start with another instance already crawling: briefly wait for its
  // atomic publication instead of starting a second crawl or showing partial data.
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    try {
      const published = decodeRow<T>(await readRow(key));
      if (published) return remember(key, published);
    } catch {
      break;
    }
  }
  throw new SnapshotUnavailableError();
}
