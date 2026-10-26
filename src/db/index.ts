import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL?.trim();

/** The public preview can run a read-only demo without provisioning Postgres. */
export const hasDatabase = Boolean(databaseUrl);

const globalForDb = globalThis as typeof globalThis & {
  __arenaNextJsPostgresqlPool?: Pool;
};

export const pool: Pool | null = databaseUrl
  ? globalForDb.__arenaNextJsPostgresqlPool ?? new Pool({ connectionString: databaseUrl })
  : null;

if (pool && process.env.NODE_ENV !== "production") {
  globalForDb.__arenaNextJsPostgresqlPool = pool;
}

// Keep a stable Drizzle type for existing database-backed modules. Callers
// must check `hasDatabase` before querying; the demo path never touches `db`.
export const db: ReturnType<typeof drizzle> = pool
  ? drizzle(pool)
  : (undefined as unknown as ReturnType<typeof drizzle>);
