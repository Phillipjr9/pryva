import "server-only";
import { createHash } from "node:crypto";
import { readSharedSnapshot } from "@/lib/platform/shared-snapshot";

export function supplierCatalogueKey(family: string, identity: string): string {
  return `supplier:${family}:v1:${createHash("sha256").update(identity).digest("hex").slice(0, 32)}`;
}

/** Shares supplier reads across instances. Raw values remain server-only. */
export async function readSupplierCatalogue<T extends {
  fetchedAt: string; partial: boolean; degraded: "funding" | "outage" | null;
}>(key: string, refresh: () => Promise<T>, maxAgeMs = 5 * 60_000): Promise<T> {
  const snapshot = await readSharedSnapshot({
    key, ttlMs: 30_000,
    refresh: async () => {
      const value = await refresh();
      // Do not republish a local fallback as a newly refreshed healthy snapshot.
      if (value.partial || value.degraded) throw new Error("Supplier catalogue refresh incomplete");
      return { value, checkedAt: value.fetchedAt };
    },
  });
  const age = Date.now() - Date.parse(snapshot.value.fetchedAt);
  if (!Number.isFinite(age) || age < -60_000 || age > maxAgeMs) throw new Error("Supplier catalogue expired");
  return snapshot.stale
    ? { ...snapshot.value, partial: true, degraded: "outage" }
    : snapshot.value;
}
