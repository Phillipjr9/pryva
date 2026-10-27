import type { db } from "@/db";

/**
 * The client a `db.transaction(async (tx) => …)` callback receives.
 *
 * Kept in its own module so libs can name it without importing the database.
 */
export type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
