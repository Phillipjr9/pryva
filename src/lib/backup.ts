/**
 * Backup and restore logic, without the database.
 *
 * ## Why this is not `pg_dump`
 *
 * `pg_dump` is the right tool and the runbook says to use it when it is
 * available. It is not always available: the deployment target is a serverless
 * platform with no shell, and the machines that *can* run it are not necessarily
 * the ones with the production connection string. So there are two ways to take
 * a copy of this database, and this module backs the second:
 *
 *   * **schema** comes from `migrations/`, which is versioned in git and
 *     replayable in order — that is what `npm run db:migrate` does;
 *   * **data** comes from this archive: one gzipped file holding a manifest and
 *     each table's rows as JSON, with a SHA-256 per table so a truncated or
 *     corrupted file is detected before anyone tries to restore it.
 *
 * Splitting schema from data is what makes the restore tractable: a fresh
 * database is built by running the migrations, then the rows are inserted in
 * foreign-key order. The manifest carries that order with it, computed from the
 * live database's constraints, so a restore does not depend on guessing.
 *
 * ## What it is not
 *
 * This is a logical snapshot, not a point-in-time record. Rows written after it
 * are not in it, and a large database must be streamed rather than read into
 * memory. For a database that matters, turn on the provider's continuous backup
 * or PITR as well, and treat this archive as the second copy that survives the
 * provider.
 */

import { createHash } from "node:crypto";

export type BackupTable = {
  /** Table name as it appears in `public`. */
  name: string;
  rows: number;
  /** SHA-256 of the serialized rows, so corruption is caught at load time. */
  sha256: string;
};

export type BackupManifest = {
  version: 1;
  /** ISO instant the snapshot was taken. */
  createdAt: string;
  /** Free-form tag: "manual", "nightly", a ticket reference. */
  label: string;
  /** Migration filenames the dump was taken against, in applied order. */
  migrations: string[];
  tables: BackupTable[];
  /** Child table → parent table, for a restore that must insert parents first. */
  foreignKeys: Array<[string, string]>;
};

/** `pryva-backup-20261030-031500.ndjson.gz` — sorts chronologically. */
export function backupFileName(createdAt: Date, prefix = "pryva-backup"): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  const stamp =
    `${createdAt.getUTCFullYear()}${pad(createdAt.getUTCMonth() + 1)}${pad(createdAt.getUTCDate())}` +
    `-${pad(createdAt.getUTCHours())}${pad(createdAt.getUTCMinutes())}${pad(createdAt.getUTCSeconds())}`;
  return `${prefix}-${stamp}.ndjson.gz`;
}

/**
 * Insert order for a restore: every parent before its children.
 *
 * A plain `ORDER BY name` fails on the first foreign key. Cycles (two tables
 * that reference each other) are real — the schema has none today, but a future
 * migration could add one — so a table caught in a cycle is appended at the end
 * rather than dropped: a restore that fails loudly on one row is better than one
 * that silently omits a table.
 */
export function insertionOrder(tables: string[], foreignKeys: Array<[string, string]>): string[] {
  const known = new Set(tables);
  const parents = new Map<string, Set<string>>();
  for (const table of tables) parents.set(table, new Set());

  for (const [child, parent] of foreignKeys) {
    if (!known.has(child) || !known.has(parent) || child === parent) continue;
    parents.get(child)!.add(parent);
  }

  const ordered: string[] = [];
  const placed = new Set<string>();
  let progressed = true;
  while (progressed) {
    progressed = false;
    // Deterministic: alphabetical among the tables that are ready to go.
    for (const table of [...tables].sort()) {
      if (placed.has(table)) continue;
      const needs = parents.get(table)!;
      if ([...needs].every((parent) => placed.has(parent))) {
        ordered.push(table);
        placed.add(table);
        progressed = true;
      }
    }
  }

  // Whatever is left is in a cycle. Keep it, at the end, in a fixed order.
  for (const table of [...tables].sort()) {
    if (!placed.has(table)) ordered.push(table);
  }
  return ordered;
}

/** Files older than `keepDays`, newest first, excluding the ones to keep. */
export function expiredBackups(
  files: Array<{ name: string; createdAt: Date }>,
  keepDays: number,
  now: Date = new Date(),
): string[] {
  if (!Number.isFinite(keepDays) || keepDays < 1) return [];
  const cutoff = now.getTime() - keepDays * 24 * 60 * 60 * 1000;
  return files
    .filter((file) => file.createdAt.getTime() < cutoff)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .map((file) => file.name);
}

/**
 * Checks a manifest against what was actually read back.
 *
 * Returns the problems rather than throwing, because the caller prints them all:
 * one truncated table is a different decision from a file that is not a Pryva
 * backup at all.
 */
export function verifyManifest(
  manifest: unknown,
  rowsByTable: Record<string, string>,
): { ok: boolean; problems: string[]; tables: number; rows: number } {
  const problems: string[] = [];
  if (!manifest || typeof manifest !== "object") {
    return { ok: false, problems: ["manifest is missing or not an object"], tables: 0, rows: 0 };
  }
  const candidate = manifest as Partial<BackupManifest>;
  if (candidate.version !== 1) problems.push(`unknown backup version: ${String(candidate.version)}`);
  if (!Array.isArray(candidate.tables) || candidate.tables.length === 0) {
    problems.push("manifest lists no tables");
  }

  let rows = 0;
  const tables = Array.isArray(candidate.tables) ? candidate.tables : [];
  for (const table of tables) {
    rows += table.rows;
    const payload = rowsByTable[table.name];
    if (payload === undefined) {
      problems.push(`table ${table.name} is listed but missing from the archive`);
      continue;
    }
    if (payload.length > 0 && sha256Hex(payload) !== table.sha256) {
      problems.push(`table ${table.name} does not match its checksum`);
    }
  }
  for (const name of Object.keys(rowsByTable)) {
    if (!tables.some((table) => table.name === name)) {
      problems.push(`table ${name} is in the archive but not in the manifest`);
    }
  }
  return { ok: problems.length === 0, problems, tables: tables.length, rows };
}

/** SHA-256 of a string or buffer, hex. */
export function sha256Hex(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
