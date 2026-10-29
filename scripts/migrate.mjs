#!/usr/bin/env node
// Applies every top-level migration in migrations/ to the configured database,
// in filename order, stopping on the first error.
//
// Why this exists: the repository shipped eleven migrations and no way to run
// them. migrations/README.md documented six, so a fresh production database
// built by following the README was silently missing order idempotency, the
// provider cost column, and the password reset token table -- each of which
// fails at query time rather than at setup time, long after the operator
// believes the deploy succeeded.
//
// Files under migrations/legacy/ are deliberately excluded: they assume tables
// that no migration in this repository creates. See migrations/README.md.
//
// Usage:
//   DATABASE_URL=postgres://... npm run db:migrate
//
// Without DATABASE_URL the connection is built from the standard libpq
// variables (PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE, PGSSLMODE), which
// is what the Vercel AWS integration provides. Note that IAM-authenticated RDS
// has no PGPASSWORD and is not supported by this script or by src/db/index.ts;
// a password-authenticated database role is required.

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import pg from "pg";

const MIGRATIONS_DIR = path.join(process.cwd(), "migrations");
const LEDGER_TABLE = "schema_migrations";

function describeConnection() {
  const url = process.env.DATABASE_URL?.trim();
  if (url) {
    // Never print credentials: report the host only, and say where it came from.
    const host = (() => {
      try {
        return new URL(url).hostname || "(unparsed)";
      } catch {
        return "(unparsable DATABASE_URL)";
      }
    })();
    return { config: { connectionString: url }, label: `DATABASE_URL -> ${host}` };
  }
  if (!process.env.PGHOST?.trim()) {
    console.error(
      "No database configured.\n" +
        "Set DATABASE_URL, or the libpq variables (PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE).\n" +
        "The Vercel AWS integration sets the PG* variables but not PGPASSWORD; if your RDS role\n" +
        "uses IAM authentication this script cannot connect, and neither can the application.",
    );
    process.exit(2);
  }
  // Passing no config makes node-postgres read PG* itself, including PGSSLMODE.
  return { config: {}, label: `PG* env -> ${process.env.PGHOST}` };
}

const { config, label } = describeConnection();
const pool = new pg.Pool(config);

const files = (await readdir(MIGRATIONS_DIR))
  .filter((name) => name.endsWith(".sql"))
  .sort();

if (files.length === 0) {
  console.error(`No migrations found in ${MIGRATIONS_DIR}`);
  process.exit(2);
}

let client;
try {
  client = await pool.connect();
} catch (error) {
  console.error(`Could not connect to the database (${label}).`);
  console.error(error.message);
  process.exit(1);
}

try {
  // The ledger records what has been applied so a re-run is a no-op rather than
  // a second application of a migration that is not written to be idempotent.
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${LEDGER_TABLE} (
      filename   text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const applied = new Set(
    (await client.query(`SELECT filename FROM ${LEDGER_TABLE}`)).rows.map((row) => row.filename),
  );

  const pending = files.filter((name) => !applied.has(name));

  if (pending.length === 0) {
    console.log(`${label}: schema is up to date (${applied.size} migration(s) recorded).`);
    process.exit(0);
  }

  console.log(`${label}: applying ${pending.length} of ${files.length} migration(s).`);

  for (const name of pending) {
    const sql = await readFile(path.join(MIGRATIONS_DIR, name), "utf8");
    // One transaction per migration: a failure rolls that migration back and
    // leaves the ledger untouched, so the run can be repeated after a fix.
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query(
        `INSERT INTO ${LEDGER_TABLE} (filename) VALUES ($1) ON CONFLICT (filename) DO NOTHING`,
        [name],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      console.error(`\nFAILED: ${name}`);
      console.error(error.message);
      console.error(
        `\nStopped. ${applied.size} migration(s) are recorded as applied; the rest were not run.`,
      );
      process.exit(1);
    }
    console.log(`  applied ${name}`);
  }

  console.log(`\nDone. ${applied.size + pending.length} migration(s) recorded.`);
} finally {
  client.release();
  await pool.end();
}
