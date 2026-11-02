import { purchaseMappedProduct } from "@/lib/mapped-purchase";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/digital/purchase
 *
 * Digital subscriptions used to be a permanent 503 with no supplier behind it.
 * See /api/airtime/purchase: both now use the same mapped, fail-closed FoxReload
 * path, and an unmapped plan still cannot be ordered or charged.
 */
export async function POST(request: Request) {
  return purchaseMappedProduct(request, "subscriptions");
}
