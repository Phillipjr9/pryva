import { NextRequest, NextResponse } from "next/server";

import { diagnosticsAuthorized } from "@/lib/diagnostics-auth";
import {
  mappedPlanIds,
  mappingFilePath,
  readMappingFile,
  PRODUCT_FAMILIES,
  mappingMissingRequirements,
  mappedPurchasesEnabled,
} from "@/lib/product-mappings";

export const dynamic = "force-dynamic";

/**
 * GET /api/diagnostics/product-mappings
 * Authorization: Bearer <DIAGNOSTICS_SECRET>  (CRON_SECRET also accepted)
 *
 * Answers "why can't data, subscriptions or proxies be bought yet?" from the
 * same gate checkout uses. Read-only: it lists our own plan IDs and the missing
 * configuration, never supplier product IDs, prices or credentials.
 */
export async function GET(request: NextRequest) {
  if (!diagnosticsAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const file = readMappingFile();
  return NextResponse.json(
    {
      mappingSource: process.env.PRODUCT_MAPPINGS_JSON?.trim()
        ? "environment"
        : mappingFilePath().split(/[\\/]/).pop(),
      errors: file.errors,
      families: PRODUCT_FAMILIES.map((family) => ({
        family,
        enabled: mappedPurchasesEnabled(family),
        mappedPlans: mappedPlanIds(family),
        missing: mappingMissingRequirements(family),
      })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
