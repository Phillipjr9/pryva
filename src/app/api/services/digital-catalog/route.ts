import { createHash } from "node:crypto";
import type { DigitalArtwork } from "@/lib/content/digital-artwork";
import { topupArtwork } from "@/lib/services/foxreload/topup-artwork";
import { reportedGiftTerms, type ReportedGiftTerms } from "@/lib/services/gift-cards/reported-terms";
import { NextRequest } from "next/server";
import { requireAuthApi } from "@/lib/identity/auth";
import { financialActionsUnavailable } from "@/lib/platform/financial-environment";
import { catalogRateLimiter } from "@/lib/platform/rate-limit";
import { retryAfterReset } from "@/lib/platform/retry-after";
import { listedCodeOffers } from "@/lib/services/foxreload/code-orders";
import { listedTopupOffers } from "@/lib/services/foxreload/topup-orders";
import { listedEsimOffers } from "@/lib/services/foxreload/esim-orders";
import { isFoxreloadConfigured, readFoxreloadBrowsePage } from "@/lib/providers/foxreload";
import { digitalCatalogueFailure } from "@/lib/services/foxreload/catalogue-failure";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Read-only customer-safe names, reported stock and optional product terms; never wholesale costs. */
export async function GET(request: NextRequest) {
  const user = await requireAuthApi();
  if (!user) return Response.json({ error: "Please sign in." }, { status: 401 });
  if (financialActionsUnavailable()) return Response.json({ error: "This catalogue is unavailable in this environment.", code: "environment" }, { status: 503, headers: { "Cache-Control": "private, no-store", "Retry-After": "60" } });
  const query = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  const cursor = request.nextUrl.searchParams.get("cursor") ?? "";
  const category = request.nextUrl.searchParams.get("category") ?? "";
  const stock = request.nextUrl.searchParams.get("stock") ?? "all";
  if ((query && (query.length < 2 || query.length > 128 || /[\u0000-\u001f\u007f]/.test(query))) ||
      (cursor && (cursor.length > 512 || /[\u0000-\u001f\u007f]/.test(cursor))) || (query && cursor) || !["all", "available"].includes(stock) || (category && !/^[a-z0-9][a-z0-9-]{0,127}$/i.test(category))) {
    return Response.json({ error: "Invalid catalogue request." }, { status: 400 });
  }
  if (!isFoxreloadConfigured()) return Response.json({ error: "This catalogue is not connected yet.", code: "unconfigured" }, { status: 503, headers: { "Cache-Control": "private, no-store", "Retry-After": "60" } });
  const limit = await catalogRateLimiter(`digital-catalog:${user.id}`);
  if (limit.unavailable) return Response.json({ error: "Catalogue temporarily unavailable." }, { status: 503, headers: { "Cache-Control": "private, no-store", "Retry-After": "30" } });
  if (!limit.allowed) return Response.json({ error: "Too many requests. Try again shortly." }, { status: 429, headers: { "Cache-Control": "private, no-store", "Retry-After": retryAfterReset(limit.resetTime) } });
  try {
    const page = await readFoxreloadBrowsePage({ query: query || undefined, cursor: cursor || undefined, ...(category ? { category } : {}), ...(stock === "available" ? { inStockOnly: true } : {}) });
    const items: { id: string; name: string; stock: "reported" | "out" | "unknown"; stockQuantity: number | null; artwork?: DigitalArtwork; reportedTerms?: ReportedGiftTerms; checkout?: "codes" | "topups" | "esims" }[] = [];
    const checkout = new Map<string, { name: string; kind: "codes" | "topups" | "esims" }>();
    for (const [kind, offers] of [["codes", listedCodeOffers()], ["topups", listedTopupOffers()], ["esims", listedEsimOffers()]] as const)
      for (const offer of offers) checkout.set(offer.id, { name: offer.name, kind });
    const seen = new Set<string>();
    let skipped = 0;
    for (const row of page.rows) {
      if (!row || typeof row !== "object" || Array.isArray(row)) { skipped++; continue; }
      const product = row as Record<string, unknown>;
      // These are supplier test orders, not real customer products.
      if (product.categoryId === "019ec7d3-db8f-7541-90a6-97469404a7df" ||
          (typeof product.slug === "string" && (product.slug === "test-orders" || product.slug.startsWith("test-orders-")))) { skipped++; continue; }
      const id = typeof product.id === "string" && product.id.length <= 256 ? product.id.trim() : "";
      const name = typeof product.name === "string" ? product.name.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 160) : "";
      if (!id || !name) { skipped++; continue; }
      const publicId = `digital-${createHash("sha256").update(id).digest("hex").slice(0, 24)}`;
      if (seen.has(publicId)) { skipped++; continue; }
      seen.add(publicId);
      const approved = checkout.get(publicId);
      const stock = typeof product.quantity === "number" && Number.isSafeInteger(product.quantity) && product.quantity >= 0
        ? product.quantity > 0 ? "reported" : "out" : "unknown";
      const artwork = topupArtwork(name, typeof product.slug === "string" ? product.slug : undefined, product.categoryId, product.deliveryType);
      const terms = product.deliveryType === "code" ? reportedGiftTerms(product.attributes) : null;
      items.push({ id: publicId, name, stock, stockQuantity: stock === "unknown" ? null : product.quantity as number, ...(artwork ? { artwork } : {}), ...(terms ? { reportedTerms: terms } : {}), ...(approved?.name === name ? { checkout: approved.kind } : {}) });
    }
    return Response.json({ ok: true, items, nextCursor: page.nextCursor, searchLimited: page.searchLimited, skipped: skipped > 0 }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    // Never relay upstream error bodies, which may contain account information.
    return digitalCatalogueFailure(error, "Could not load the catalogue. Try again later.");
  }
}
