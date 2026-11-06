import { NextRequest } from "next/server";
import { authorizeAdminApi } from "@/lib/identity/admin-auth";
import { readSupplierHealth } from "@/lib/admin/supplier-health";

export const dynamic = "force-dynamic";

/**
 * What the number suppliers can actually do right now, for the operator.
 *
 * A fallback supplier is only real if it is configured *and* answering, and both
 * of those fail silently at purchase time: a bad key just means the catalogue
 * comes back empty and the purchase quietly proceeds with the other supplier.
 * Silent is the right behaviour for a customer and the wrong one for whoever set
 * the key, so this endpoint answers the question directly.
 *
 * It is strictly read-only. Nothing here buys, cancels or reactivates: a
 * diagnostic that can spend money is a diagnostic nobody dares call in
 * production. Only error *codes* are reported — never an upstream message (which
 * can carry a response body) and never any part of a credential.
 */
export async function GET(request: NextRequest) {
  const access = await authorizeAdminApi(request);
  if (access.response) return access.response;

  const requested = new URL(request.url).searchParams.get("country")?.trim().toLowerCase() || null;
  const body = await readSupplierHealth({ country: requested });

  return Response.json(
    {
      ok: true,
      ...body,
      esim: { orderable: body.gateway.balance !== null },
    },
    { headers: { "cache-control": "no-store" } },
  );
}
