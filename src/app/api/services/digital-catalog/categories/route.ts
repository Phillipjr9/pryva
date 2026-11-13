import { requireAuthApi } from "@/lib/identity/auth";
import { financialActionsUnavailable } from "@/lib/platform/financial-environment";
import { catalogRateLimiter } from "@/lib/platform/rate-limit";
import { retryAfterReset } from "@/lib/platform/retry-after";
import { isFoxreloadConfigured, readFoxreloadBrowseCategories } from "@/lib/providers/foxreload";
import { digitalCatalogueFailure } from "@/lib/services/foxreload/catalogue-failure";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const labels: Record<string, string> = {
  esim: "eSIM", rewarble: "Rewarble", "test-orders": "Test products", "game-currency": "Game currency codes",
  topups: "Account top-ups", "gaming-services": "Gaming services", games: "Games", "app-stores": "App stores",
  "gift-cards": "Gift cards", subscriptions: "Subscriptions and services", "prepaid-finance": "Prepaid and finance",
};
export async function GET() {
  const user = await requireAuthApi();
  if (!user) return Response.json({ error: "Please sign in." }, { status: 401 });
  if (financialActionsUnavailable()) return Response.json({ error: "Categories are unavailable in this environment.", code: "environment" }, { status: 503, headers: { "Cache-Control": "private, no-store", "Retry-After": "60" } });
  if (!isFoxreloadConfigured()) return Response.json({ error: "Categories are not connected yet.", code: "unconfigured" }, { status: 503, headers: { "Cache-Control": "private, no-store", "Retry-After": "60" } });
  const limit = await catalogRateLimiter(`digital-catalog-categories:${user.id}`);
  if (limit.unavailable) return Response.json({ error: "Categories are temporarily unavailable." }, { status: 503, headers: { "Cache-Control": "private, no-store", "Retry-After": "30" } });
  if (!limit.allowed) return Response.json({ error: "Too many requests. Try again shortly." }, { status: 429, headers: { "Cache-Control": "private, no-store", "Retry-After": retryAfterReset(limit.resetTime) } });
  try {
    const rows = await readFoxreloadBrowseCategories();
    const seen = new Set<string>();
    const categories: { id: string; name: string }[] = [];
    for (const row of rows) {
      if (!row || typeof row !== "object" || Array.isArray(row)) continue;
      const { slug, name } = row as Record<string, unknown>;
      if (typeof slug !== "string" || !/^[a-z0-9][a-z0-9-]{0,127}$/i.test(slug) || slug === "test-orders" || seen.has(slug)) continue;
      const cleaned = typeof name === "string" ? name.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 100) : "";
      if (!cleaned) continue;
      seen.add(slug);
      categories.push({ id: slug, name: labels[slug] ?? cleaned });
    }
    return Response.json({ ok: true, categories }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return digitalCatalogueFailure(error, "Could not load categories. Try again later."); }
}
