import type { Config } from "drizzle-kit";

/**
 * Drizzle Kit config.
 *
 * `npx drizzle-kit generate` writes schema SQL into ./migrations. `0000_base_schema.sql`
 * is the full CREATE TABLE set for the baseline schema — the file a fresh database
 * needs. Later tables arrive through the numbered migrations beside it; this file is
 * the only Drizzle configuration (`drizzle.config.json` was removed because a second
 * config with a hard-coded localhost URL made it ambiguous which one the CLI used).
 * Before this existed there was no way to create a fresh production database:
 * every migration in the folder was an additive ALTER on tables nothing created.
 */
export default {
  schema: "./src/db/schema.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://localhost:5432/pryva",
  },
} satisfies Config;
