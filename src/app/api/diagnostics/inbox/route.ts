import { NextRequest, NextResponse } from "next/server";
import { count, gt } from "drizzle-orm";

import { db } from "@/db";
import { disposableInboxes } from "@/db/schema";
import { diagnosticsAuthorized } from "@/lib/diagnostics-auth";
import { isPreviewDatabase } from "@/lib/demo-policy";
import { isFleexaConfigured, listFleexaEmailProducts, type FleexaEmailProduct } from "@/lib/fleexa";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * GET /api/diagnostics/inbox
 * Authorization: Bearer <DIAGNOSTICS_SECRET>  (CRON_SECRET also accepted)
 *
 * "Why can nobody create a free inbox?"
 *
 * Four things can refuse a creation, and from the outside they looked identical:
 * the deployment has no database (preview), the inbox feed has no credential, the
 * feed has nothing to sell, or the feed refuses the purchase. The button said "not
 * switched on yet" for the first two and "Could not create an inbox" for the last
 * two, which is why the question kept coming back.
 *
 * This answers it without creating anything: a product list is a read, and the
 * counts come from our own table. Nothing here can spend money — a probe that buys
 * an inbox to see whether buying works is not a diagnostic, it is a sale.
 */
type Verdict = "ready" | "preview" | "not_configured" | "no_products" | "unreachable";

export async function GET(request: NextRequest) {
  if (!diagnosticsAuthorized(request)) {
    logger.warn("Unauthorized inbox diagnostics attempt");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const preview = isPreviewDatabase();
  const configured = isFleexaConfigured();

  let products: FleexaEmailProduct[] | null = null;
  let productsError: string | null = null;
  if (configured) {
    try {
      products = await listFleexaEmailProducts();
    } catch (error) {
      productsError = error instanceof Error ? error.message : String(error);
    }
  }

  // Aggregate only: how many inboxes exist by state in the last day. No addresses,
  // no account ids — this endpoint is about the lane, not about a person.
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  let recent: { status: string; total: number }[] | null = null;
  if (!preview) {
    try {
      const rows = await db
        .select({ status: disposableInboxes.status, total: count(disposableInboxes.id) })
        .from(disposableInboxes)
        .where(gt(disposableInboxes.createdAt, since))
        .groupBy(disposableInboxes.status);
      recent = rows.map((row) => ({ status: row.status, total: Number(row.total) }));
    } catch (error) {
      logger.error("Inbox diagnostics could not read the inbox table", {
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const active = recent?.find((row) => row.status === "active")?.total ?? 0;
  const usable = products?.filter((product) => product.stock === null || product.stock > 0) ?? [];

  const verdict: Verdict = preview
    ? "preview"
    : !configured
      ? "not_configured"
      : products === null
        ? "unreachable"
        : usable.length === 0
          ? "no_products"
          : "ready";

  const explanation: Record<Verdict, string> = {
    ready: `The feed lists ${usable.length} usable inbox product${usable.length === 1 ? "" : "s"}, so a creation should be attempted and priced from the cheapest.`,
    preview: "This deployment has no persistent database, so creating an inbox is refused before anything else runs.",
    not_configured: "The inbox feed has no credential on this deployment, so there is nothing to buy an inbox from.",
    unreachable: `The feed could not be read${productsError ? `: ${productsError}` : ""}. This is a network, key or rate-limit problem, not a database one.`,
    no_products: "The feed answered and lists no inbox product with stock. Selling one would mean selling something it cannot deliver.",
  };

  return NextResponse.json(
    {
      checkedAt: new Date().toISOString(),
      verdict,
      explanation: explanation[verdict],
      gates: { preview, configured },
      products: products === null
        ? { readable: false, error: productsError }
        : {
            readable: true,
            count: products.length,
            usable: usable.length,
            cheapest: usable.length
              ? [...usable].sort(
                  (a, b) => (a.priceNgn ?? Number.POSITIVE_INFINITY) - (b.priceNgn ?? Number.POSITIVE_INFINITY),
                )[0]
              : null,
          },
      last24Hours: recent ?? "unavailable",
      activeInboxes: active,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
