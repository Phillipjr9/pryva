#!/usr/bin/env node
// Takes a logical snapshot of the configured database.
//
//   DATABASE_URL=postgres://... npm run db:backup
//   DATABASE_URL=postgres://... npm run db:backup -- --out ./backups --keep 14
//   npm run db:backup -- --verify backups/pryva-backup-20261030-031500.ndjson.gz
//
// What it writes: one gzipped file. The first line is a manifest (version,
// instant, applied migrations, table list with row counts and a SHA-256 per
// table, and the foreign-key edges a restore needs). Every following line is one
// table's rows as JSON.
//
// Why not pg_dump: see the comment at the top of src/lib/backup.ts. In short,
// the schema is reproducible from migrations/, so this archive carries data and
// the restore rebuilds the schema first.
//
// This is a second copy, not a substitute for the provider's own backups. The
// runbook says so, and says where to put the file.

import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { mkdir, readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { createInterface } from "node:readline";
import { createGunzip, createGzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import pg from "pg";
import {
  backupFileName,
  expiredBackups,
  sha256Hex,
  verifyManifest,
} from "../src/lib/backup.ts";

function arg(name, fallback = "") {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] && !process.argv[index + 1].startsWith("--")
    ? process.argv[index + 1]
    : fallback;
}

function connectionString() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const { PGHOST, PGPORT = "5432", PGUSER, PGPASSWORD, PGDATABASE } = process.env;
  if (PGHOST && PGUSER && PGDATABASE) {
    const password = PGPASSWORD ? `:${encodeURIComponent(PGPASSWORD)}` : "";
    return `postgres://${encodeURIComponent(PGUSER)}${password}@${PGHOST}:${PGPORT}/${PGDATABASE}`;
  }
  return "";
}

async function verify(file) {
  if (!existsSync(file)) {
    console.error(`No such backup: ${file}`);
    process.exit(1);
  }
  const rowsByTable = {};
  let manifest = null;
  const reader = createInterface({ input: createReadStream(file).pipe(createGunzip()), crlfDelay: Infinity });
  for await (const line of reader) {
    if (!line.trim()) continue;
    const parsed = JSON.parse(line);
    if (parsed.__manifest) {
      manifest = parsed.__manifest;
      continue;
    }
    rowsByTable[parsed.table] = JSON.stringify(parsed.rows);
  }
  const result = verifyManifest(manifest, rowsByTable);
  const size = (await stat(file)).size;
  console.log(`${file} — ${(size / 1024 / 1024).toFixed(2)} MB`);
  console.log(`  taken     ${manifest?.createdAt ?? "unknown"}`);
  console.log(`  label     ${manifest?.label ?? "unknown"}`);
  console.log(`  migrations ${manifest?.migrations?.length ?? 0}`);
  console.log(`  tables    ${result.tables}, rows ${result.rows}`);
  if (!result.ok) {
    for (const problem of result.problems) console.error(`  PROBLEM  ${problem}`);
    process.exit(1);
  }
  console.log("  checksums OK");
}

async function main() {
  const verifyTarget = arg("verify");
  if (verifyTarget) {
    await verify(verifyTarget);
    return;
  }

  const url = connectionString();
  if (!url) {
    console.error(
      "Set DATABASE_URL (or PGHOST/PGUSER/PGPASSWORD/PGDATABASE) to the database you want to copy.\n" +
        "Refusing to guess: a backup written to the wrong database is worse than none.",
    );
    process.exit(1);
  }
  if (process.env.NODE_ENV === "test") {
    console.error("Refusing to run under NODE_ENV=test.");
    process.exit(1);
  }

  const outDir = path.resolve(arg("out", "backups"));
  const keepDays = Number.parseInt(arg("keep", "14"), 10);
  const label = arg("label", "manual");
  const createdAt = new Date();
  const file = path.join(outDir, backupFileName(createdAt));
  await mkdir(outDir, { recursive: true });

  const client = new pg.Client({ connectionString: url, ssl: /sslmode=require/.test(url) ? { rejectUnauthorized: false } : undefined });
  await client.connect();

  try {
    const tables = (
      await client.query(
        `SELECT table_name FROM information_schema.tables
          WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
          ORDER BY table_name`,
      )
    ).rows.map((row) => row.table_name);

    const migrations = await client
      .query(`SELECT name FROM schema_migrations ORDER BY name`)
      .then((result) => result.rows.map((row) => row.name))
      .catch(() => []);

    const foreignKeys = (
      await client.query(
        `SELECT child.relname AS child, parent.relname AS parent
           FROM pg_constraint c
           JOIN pg_class child ON child.oid = c.conrelid
           JOIN pg_class parent ON parent.oid = c.confrelid
           JOIN pg_namespace n ON n.oid = child.relnamespace
          WHERE c.contype = 'f' AND n.nspname = 'public'`,
      )
    ).rows.map((row) => [row.child, row.parent]);

    const manifest = { version: 1, createdAt: createdAt.toISOString(), label, migrations, tables: [], foreignKeys };

    // Rows are read per table and written through the gzip stream one line at a
    // time. A table larger than memory is the documented limit of this script;
    // it fails loudly here rather than writing a truncated archive.
    const gzip = createGzip({ level: 9 });
    const output = createWriteStream(file);
    const done = pipeline(gzip, output);

    const write = (value) =>
      new Promise((resolve, reject) => {
        const line = `${JSON.stringify(value)}\n`;
        if (!gzip.write(line)) gzip.once("drain", resolve);
        else resolve();
        gzip.once("error", reject);
      });

    // Checksums have to be known before the manifest line is written, so each
    // table is serialized once and then streamed.
    const payloads = {};
    for (const table of tables) {
      const rows = (await client.query(`SELECT * FROM "${table.replace(/"/g, '""')}"`)).rows;
      const payload = JSON.stringify(rows);
      payloads[table] = { payload, rows: rows.length, sha256: sha256Hex(payload) };
      manifest.tables.push({ name: table, rows: rows.length, sha256: sha256Hex(payload) });
    }

    await write({ __manifest: manifest });
    for (const table of tables) {
      await write({ table, rows: JSON.parse(payloads[table].payload) });
      delete payloads[table];
    }
    gzip.end();
    await done;

    const size = (await stat(file)).size;
    console.log(`Wrote ${file}`);
    console.log(`  ${manifest.tables.length} tables, ${manifest.tables.reduce((sum, t) => sum + t.rows, 0)} rows, ${(size / 1024 / 1024).toFixed(2)} MB gzipped`);
    console.log(`  migrations recorded: ${manifest.migrations.length}`);

    // Verify what was just written before deleting anything older: a retention
    // sweep that runs ahead of a successful backup is how people end up with no
    // backups at all.
    await verify(file);

    if (keepDays > 0) {
      const existing = await readdir(outDir);
      const files = await Promise.all(
        existing
          .filter((name) => /^pryva-backup-\d{8}-\d{6}\.ndjson\.gz$/.test(name))
          .map(async (name) => ({ name, createdAt: (await stat(path.join(outDir, name))).mtime })),
      );
      const stale = expiredBackups(files, keepDays, createdAt).filter(
        (name) => path.join(outDir, name) !== file,
      );
      for (const name of stale) {
        await unlink(path.join(outDir, name));
        console.log(`  pruned ${name}`);
      }
    }
  } finally {
    await client.end();
  }
}

main().catch(async (error) => {
  console.error("Backup failed:", error instanceof Error ? error.message : error);
  // A half-written archive must not be mistaken for a backup.
  try {
    const outDir = path.resolve(arg("out", "backups"));
    const partial = path.join(outDir, backupFileName(new Date()));
    if (existsSync(partial)) await unlink(partial);
  } catch {
    // best effort
  }
  process.exit(1);
});
