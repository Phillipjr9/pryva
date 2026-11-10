import { requireAdmin } from "@/lib/identity/auth";
import { probeCatalog } from "@/lib/providers/bulkacc";
import { isAccsZoneConfigured } from "@/lib/providers/accszone";

export const dynamic = "force-dynamic";

/** A read-only, admin-gated check. Never render upstream messages or credentials. */
export default async function AccountCatalogHealthPage() {
  await requireAdmin("/admin/account-catalog");
  const catalog = await probeCatalog();
  const fallbackConfigured = isAccsZoneConfigured();
  const descriptions = {
    not_configured: "The primary account feed is not configured.",
    serving: "The primary account feed returned products to a small live probe.",
    no_products: "The primary account feed returned no products to the live probe. This does not distinguish an empty catalog from a refused request.",
    failed: "The primary account feed could not be checked successfully.",
  } as const;
  const errorCode = catalog.state === "failed" && /^[a-z0-9_-]{1,60}$/i.test(catalog.code)
    ? catalog.code : null;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[1.5rem] font-medium tracking-tight">Account catalog status</h1>
        <p className="mt-1 text-sm text-ink-2">A read-only check. No account is purchased and no settings are changed.</p>
      </div>
      <section className="rounded-2xl border border-line bg-white p-4">
        <h2 className="font-semibold">Primary account feed</h2>
        <p className="mt-2 text-sm">Status: <strong>{catalog.state}</strong></p>
        <p className="mt-1 text-sm text-ink-2">{descriptions[catalog.state]}</p>
        {catalog.state === "serving" && catalog.totalCount !== null && (
          <p className="mt-1 text-sm text-ink-2">Products reported by the feed: {catalog.totalCount}</p>
        )}
        {errorCode && <p className="mt-1 text-sm text-ink-2">Error code: {errorCode}</p>}
      </section>
      <section className="rounded-2xl border border-line bg-white p-4">
        <h2 className="font-semibold">Fallback account feed</h2>
        <p className="mt-2 text-sm">Configured: <strong>{fallbackConfigured ? "yes" : "no"}</strong></p>
        <p className="mt-1 text-sm text-ink-2">Configuration alone does not confirm that the feed is working or has stock.</p>
      </section>
      <p className="text-sm text-ink-2">Share the status and error code with support if you need help. Never share keys or tokens.</p>
    </div>
  );
}
