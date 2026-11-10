import { authorizeAdminApi } from "@/lib/identity/admin-auth";
import { createRateLimiter } from "@/lib/platform/rate-limit";
import { isFoxreloadConfigured, readFoxreloadBrowsePage, readFoxreloadProductContract } from "@/lib/providers/foxreload";

export const dynamic = "force-dynamic";
export const maxDuration = 30;
const limit = createRateLimiter({ windowMs: 60_000, maxRequests: 15 });
const reply = (body: object, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
const productId = /^product_[a-z0-9]{26}$/;

/** Read-only product review. No create, payment, or configuration changes. */
export async function GET(request: Request) {
  const access = await authorizeAdminApi(request);
  if (access.response) return access.response;
  const params = new URL(request.url).searchParams;
  const query = params.get("q")?.trim() ?? "", id = params.get("id") ?? "";
  if ((!query && !id) || (query && id) || (query && (query.length < 2 || query.length > 80 || /[\u0000-\u001f\u007f]/.test(query))) || (id && !productId.test(id))) return reply({ ok: false, error: "Enter a valid product search or ID." }, 400);
  const allowed = await limit(`admin:foxreload-products:${access.user.id}`);
  if (allowed.unavailable) return reply({ ok: false, error: "Product review temporarily unavailable." }, 503);
  if (!allowed.allowed) return reply({ ok: false, error: "Too many requests. Try again shortly." }, 429);
  if (!isFoxreloadConfigured()) return reply({ ok: false, error: "Supplier account not configured." }, 503);
  try {
    if (id) {
      // Strict adapter only returns selected fields, not the supplier response body.
      const product = await readFoxreloadProductContract(id);
      return reply({ ok: true, product });
    }
    const page = await readFoxreloadBrowsePage({ query });
    const seen = new Set<string>();
    const items: { id: string; name: string }[] = [];
    for (const row of page.rows) {
      if (!row || typeof row !== "object" || Array.isArray(row)) continue;
      const { id: rawId, name } = row as Record<string, unknown>;
      if (typeof rawId !== "string" || !productId.test(rawId) || seen.has(rawId) || typeof name !== "string") continue;
      const cleaned = name.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 256);
      if (!cleaned) continue;
      seen.add(rawId); items.push({ id: rawId, name: cleaned });
    }
    return reply({ ok: true, items, searchLimited: page.searchLimited });
  } catch {
    return reply({ ok: false, error: "Could not read this product. Try again later." }, 503);
  }
}
