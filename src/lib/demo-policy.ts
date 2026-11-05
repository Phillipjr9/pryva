/** True when the app uses the empty, process-local database instead of Postgres.
 * Aurora IAM is a persistent database even when DATABASE_URL is absent.
 */
import { persistentDatabaseConfigured } from "@/lib/database-config";

export function isPreviewDatabase(): boolean {
  return !persistentDatabaseConfigured();
}
