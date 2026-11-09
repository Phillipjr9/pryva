import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { requireAuthApi } from "@/lib/identity/auth";
import { financialActionsUnavailable } from "@/lib/platform/financial-environment";
import { catalogRateLimiter } from "@/lib/platform/rate-limit";
import { isFoxreloadConfigured, readFoxreloadBrowsePage } from "@/lib/providers/foxreload";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Read-only, customer-safe names: no supplier IDs, costs, stock or purchase action. */
export async function GET(request: NextRequest) {
  const user = await requireAuthApi();
  if (!user) return Response.json({ error: "Please sign in." }, { status: 401 });
  if (financialActionsUnavailable()) return Response.json({ error: "This catalogue is unavailable in this environment." }, { status: 503 });
  const query = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  const cursor = request.nextUrl.searchParams.get("cursor") ?? "";
  if ((query && (query.length < 2 || query.length > 128 || /[\u0000-\u001f\u007f]/.test(query))) ||
      (cursor && (cursor.length > 512 || /[\u0000-\u001f\u007f]/.test(cursor))) || (query && cursor)) {
    return Response.json({ error: "Invalid catalogue request." }, { status: 400 });
  }
  if (!isFoxreloadConfigured()) return Response.json({ error: "This catalogue is not connected yet." }, { status: 503 });
  const limit = await catalogRateLimiter(`digital-catalog:${user.id}`);
  if (limit.unavailable) return Response.json({ error: "Catalogue temporarily unavailable." }, { status: 503 });
  if (!limit.allowed) return Response.json({ error: "Too many requests. Try again shortly." }, { status: 429 });
  try {
    const page = await readFoxreloadBrowsePage({ query: query || undefined, cursor: cursor || undefined });
    const items: { id: string; name: string }[] = [];
    const seen = new Set<string>();
    let skipped = 0;
    for (const row of page.rows) {
      if (!row || typeof row !== "object" || Array.isArray(row)) { skipped++; continue; }
      const product = row as Record<string, unknown>;
      const id = typeof product.id === "string" && product.id.length <= 256 ? product.id.trim() : "";
      const name = typeof product.name === "string" ? product.name.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 160) : "";
      if (!id || !name) { skipped++; continue; }
      const publicId = `digital-${createHash("sha256").update(id).digest("hex").slice(0, 24)}`;
      if (seen.has(publicId)) { skipped++; continue; }
      seen.add(publicId);
      items.push({ id: publicId, name });
    }
    return Response.json({ ok: true, items, nextCursor: page.nextCursor, searchLimited: page.searchLimited, skipped: skipped > 0 }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    // Never relay upstream error bodies, which may contain account information.
    return Response.json({ error: "Could not load the catalogue. Try again later." }, { status: 503, headers: { "Cache-Control": "private, no-store" } });
  }
}
