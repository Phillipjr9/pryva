import { NextRequest } from "next/server";
import { requireAuthApi } from "@/lib/identity/auth";
import { financialActionsUnavailable } from "@/lib/platform/financial-environment";
import { catalogRateLimiter } from "@/lib/platform/rate-limit";
import { retryAfterReset } from "@/lib/platform/retry-after";
import { isFoxreloadConfigured, readFoxreloadCategoryChildren } from "@/lib/providers/foxreload";
import { digitalCatalogueFailure } from "@/lib/services/foxreload/catalogue-failure";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: NextRequest) {
  const user = await requireAuthApi();
  if (!user) return Response.json({ error: "Please sign in." }, { status: 401 });
  if (financialActionsUnavailable()) return Response.json({ error: "Categories are unavailable in this environment.", code: "environment" }, { status: 503, headers: { "Cache-Control": "private, no-store", "Retry-After": "60" } });
  if (!isFoxreloadConfigured()) return Response.json({ error: "Categories are not connected yet.", code: "unconfigured" }, { status: 503, headers: { "Cache-Control": "private, no-store", "Retry-After": "60" } });
  const parent = request.nextUrl.searchParams.get("parent") ?? "";
  const name = request.nextUrl.searchParams.get("name")?.trim() ?? "";
  const cursor = request.nextUrl.searchParams.get("cursor") ?? "";
  if (!/^[a-z0-9][a-z0-9-]{0,127}$/i.test(parent) || parent === "test-orders" || name.length > 128 || cursor.length > 512 || /[\u0000-\u001f\u007f]/.test(name + cursor)) return Response.json({ error: "Invalid category request." }, { status: 400 });
  const limit = await catalogRateLimiter(`digital-catalog-categories:${user.id}`);
  if (limit.unavailable) return Response.json({ error: "Categories are temporarily unavailable." }, { status: 503, headers: { "Cache-Control": "private, no-store", "Retry-After": "30" } });
  if (!limit.allowed) return Response.json({ error: "Too many requests. Try again shortly." }, { status: 429, headers: { "Cache-Control": "private, no-store", "Retry-After": retryAfterReset(limit.resetTime) } });
  try {
    const page = await readFoxreloadCategoryChildren({ parent, ...(name ? { name } : {}), ...(cursor ? { cursor } : {}) });
    const seen = new Set<string>();
    const categories = page.rows.flatMap((row) => {
      if (!row || typeof row !== "object" || Array.isArray(row)) return [];
      const { slug, name } = row as Record<string, unknown>;
      const cleaned = typeof name === "string" ? name.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 100) : "";
      if (typeof slug !== "string" || !/^[a-z0-9][a-z0-9-]{0,127}$/i.test(slug) || slug === "test-orders" || !cleaned || seen.has(slug)) return [];
      seen.add(slug);
      return [{ id: slug, name: cleaned }];
    });
    return Response.json({ ok: true, categories, nextCursor: page.nextCursor }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return digitalCatalogueFailure(error, "Could not load categories. Try again later."); }
}
