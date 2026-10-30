#!/usr/bin/env node
// Restores a `.ndjson.gz` archive written by `npm run db:backup` into an empty,
// migrated database.
//
//   DATABASE_URL=postgres://... npm run db:migrate
//   npm run db:restore -- --file backups/pryva-backup-20261030-031500.ndjson.gz \
//                          --target postgres://... --confirm-restore
//
// Two refusals, both deliberate:
//
//   * it will not write into a database that already has rows in the tables the
//     archive contains, unless `--allow-overwrite` is passed. A restore into the
//     wrong database is a data-loss event, and "are you sure" is not enough;
//   * it will not run without `--confirm-restore`. The flag exists so the command
//     cannot be fired by a stray shell expansion or a copy-paste of the wrong
//     line from a runbook.
//
// Order matters: rows go in parent-before-child, using the foreign-key edges
// recorded in the manifest rather than a guess about this schema. Every table's
// checksum is verified before a single row is written, so a corrupted archive
// fails with nothing half-restored.

import { createReadStream, existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { createGunzip } from "node:zlib";
import process from "node:process";
import pg from "pg";
import { insertionOrder, verifyManifest } from "../src/lib/backup.ts";

function arg(name, fallback = "") {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] && !process.argv[index + 1].startsWith("--")
    ? process.argv[index + 1]
    : fallback;
}

const BATCH = 250;

async function loadArchive(file) {
  if (!existsSync(file)) throw new Error(`No such archive: ${file}`);
  const rowsByTable = {};
  const payloadText = {};
  let manifest = null;
  const reader = createInterface({ input: createReadStream(file).pipe(createGunzip()), crlfDelay: Infinity });
  for await (const line of reader) {
    if (!line.trim()) continue;
    const parsed = JSON.parse(line);
    if (parsed.__manifest) {
      manifest = parsed.__manifest;
      continue;
    }
    payloadText[parsed.table] = JSON.stringify(parsed.rows);
    rowsByTable[parsed.table] = parsed.rows;
  }
  return { manifest, rowsByTable, payloadText };
}

async function main() {
  const file = arg("file");
  const target = arg("target") || process.env.RESTORE_DATABASE_URL || "";
  const confirmed = process.argv.includes("--confirm-restore");
  const allowOverwrite = process.argv.includes("--allow-overwrite");

  if (!file) {
    console.error("Pass --file <archive.ndjson.gz>.");
    process.exit(1);
  }
  if (!target) {
    console.error("Pass --target <connection string> (or set RESTORE_DATABASE_URL).");
    process.exit(1);
  }
  if (process.env.DATABASE_URL && target === process.env.DATABASE_URL) {
    console.error(
      "The target is the same database DATABASE_URL points at. Restoring over the live database\n" +
        "is not something this script will do, even with --confirm-restore: restore into a new\n" +
        "database, check it, then switch the application over.",
    );
    process.exit(1);
  }
  if (!confirmed) {
    console.error(
      "Refusing to write without --confirm-restore.\n" +
        `About to restore ${file} into ${target.replace(/:\/\/[^@]*@/, "://***@")}.`,
    );
    process.exit(1);
  }

  const { manifest, rowsByTable, payloadText } = await loadArchive(file);
  const check = verifyManifest(manifest, payloadText);
  if (!check.ok) {
    for (const problem of check.problems) console.error(`  PROBLEM  ${problem}`);
    console.error("Archive failed verification; nothing was written.");
    process.exit(1);
  }
  console.log(`Archive OK: ${check.tables} tables, ${check.rows} rows, taken ${manifest.createdAt}.`);

  const client = new pg.Client({ connectionString: target });
  await client.connect();
  const order = insertionOrder(
    manifest.tables.map((table) => table.name),
    manifest.foreignKeys ?? [],
  );

  try {
    if (!allowOverwrite) {
      for (const table of manifest.tables) {
        const { rows } = await client.query(`SELECT count(*)::int AS n FROM "${table.name.replace(/"/g, '""')}"`);
        if (rows[0].n > 0) {
          console.error(
            `Target table ${table.name} already has ${rows[0].n} rows. Restore into an empty database,\n` +
              "or pass --allow-overwrite if you mean to merge into it.",
          );
          process.exit(1);
        }
      }
    }

    await client.query("BEGIN");
    const restored = {};
    for (const table of order) {
      const rows = rowsByTable[table] ?? [];
      const name = `"${table.replace(/"/g, '""')}"`;
      for (let start = 0; start < rows.length; start += BATCH) {
        const batch = rows.slice(start, start + BATCH);
        const columns = Object.keys(batch[0]);
        const columnList = columns.map((column) => `"${column.replace(/"/g, '""')}"`).join(", ");
        const values = [];
        const tuples = batch.map((row) => {
          const placeholders = columns.map((column) => {
            values.push(row[column]);
            return `$${values.length}`;
          });
          return `(${placeholders.join(", ")})`;
        });
        await client.query(`INSERT INTO ${name} (${columnList}) VALUES ${tuples.join(", ")}`, values);
      }
      restored[table] = rows.length;
      if (rows.length > 0) console.log(`  ${table}: ${rows.length}`);
    }
    await client.query("COMMIT");
    console.log(`Restored ${Object.values(restored).reduce((a, b) => a + b, 0)} rows across ${order.length} tables.`);
    console.log(
      "Next: run the app against this database and check the wallet ledger against the payment\n" +
        "provider before switching traffic over. The archive's manifest records the migrations it\n" +
        "was taken against; if `db:migrate` applied more, expect new columns to be at their defaults.",
    );
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("Restore failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
