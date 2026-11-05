import { requireAdmin } from "@/lib/auth";
import { RefundsConsole } from "@/components/admin/RefundsConsole";

export const dynamic = "force-dynamic";

/**
 * Refunds an admin can act on.
 *
 * /api/admin/refunds had both a listing and a mutation and neither had a reader
 * outside the test suite, so an admin could not see or issue a refund without
 * calling the API by hand. Authorisation stays server-side here; the console
 * fetches the endpoints from the browser, which gives both of them a consumer
 * and keeps the session cookie out of any server-to-server call.
 */
export default async function AdminRefundsPage() {
  await requireAdmin();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">Refunds</h1>
        <p className="mt-1 text-sm text-ink-2">
          Failed orders awaiting a refund, and refunds already issued. Refunding here credits the
          customer&rsquo;s wallet immediately.
        </p>
      </div>
      <RefundsConsole />
    </div>
  );
}
