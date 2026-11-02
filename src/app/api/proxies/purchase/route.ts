import { purchaseMappedProduct } from "@/lib/mapped-purchase";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST /api/proxies/purchase
 *
 * Proxies had no purchase route at all, only a catalogue. The endpoint stays
 * mounted so a caller receives an actionable 503 (missing key, missing mapping)
 * rather than a 404, and so enabling proxies means adding verified product IDs
 * to the mapping file rather than removing a gate.
 */
export async function POST(request: Request) {
  return purchaseMappedProduct(request, "proxies");
}
