import { purchaseMappedProduct } from "@/lib/mapped-purchase";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/airtime/purchase
 *
 * Mobile data used to be a permanent 503 with no supplier behind it. It now
 * shares the FoxReload-backed purchase path with subscriptions and proxies: a
 * plan is sellable only when an operator has mapped it to a real, code-delivering
 * supplier product and the supplier key is configured. With an empty mapping
 * file this still refuses every request, but the 503 now names exactly what is
 * missing instead of saying only "not available yet".
 */
export async function POST(request: Request) {
  return purchaseMappedProduct(request, "data");
}
