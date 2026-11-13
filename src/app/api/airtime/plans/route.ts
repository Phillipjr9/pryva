import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { requireAuthApi } from "@/lib/identity/auth";
import {
  ClubkonnectAccountError,
  isClubkonnectCatalogueConfigured,
  listClubkonnectCatalogue,
  type ClubkonnectCatalogue,
} from "@/lib/providers/clubkonnect";
import { readSharedSnapshot } from "@/lib/platform/shared-snapshot";
import { catalogRateLimiter } from "@/lib/platform/rate-limit";
import { retryAfterReset } from "@/lib/platform/retry-after";
import { logger } from "@/lib/platform/logger";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const headers = { "Cache-Control": "private, no-store" };

/**
 * How old a published catalogue may be before it is withheld.
 *
 * This used to be thirty minutes. The snapshot refreshes itself every minute, so
 * the only way to exceed thirty minutes is for the supplier read to keep failing —
 * and withholding the last complete catalogue then replaced browsable listings
 * with "the snapshot has expired, retry shortly", which no amount of retrying
 * could fix. Published prices on this page are explicitly not checkout quotes
 * (`checkoutAvailable` is false), so a six-hour-old complete catalogue is far more
 * useful than an empty page, and the response still says `stale: true`.
 */
const MAX_SNAPSHOT_AGE_MS = 6 * 60 * 60_000;

type SnapshotValue = Pick<ClubkonnectCatalogue, "plans" | "skipped" | "emptyNetworks">;

/**
 * Snapshots written before this route reported completeness hold a bare array.
 * Reading one after a deploy must not turn every listing into a 503.
 */
function decodeSnapshot(value: unknown): SnapshotValue | null {
  if (Array.isArray(value)) return { plans: value as SnapshotValue["plans"], skipped: 0, emptyNetworks: [] };
  if (!value || typeof value !== "object") return null;
  const body = value as Record<string, unknown>;
  if (!Array.isArray(body.plans)) return null;
  const skipped = typeof body.skipped === "number" && Number.isSafeInteger(body.skipped) && body.skipped > 0 ? body.skipped : 0;
  const emptyNetworks = Array.isArray(body.emptyNetworks)
    ? body.emptyNetworks.filter((name): name is string => typeof name === "string" && Boolean(name.trim()))
    : [];
  return { plans: body.plans as SnapshotValue["plans"], skipped, emptyNetworks };
}

export async function GET() {
  const user = await requireAuthApi();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
  if (!isClubkonnectCatalogueConfigured()) {
    return NextResponse.json({ error: "The mobile data catalogue is not connected yet.", code: "unconfigured" }, {
      status: 503, headers: { ...headers, "Retry-After": "60" },
    });
  }
  const limit = await catalogRateLimiter(`clubkonnect:plans:${user.id}`);
  if (!limit.allowed || limit.unavailable) return NextResponse.json({ error: "Please try again shortly." }, {
    status: limit.unavailable ? 503 : 429,
    headers: { ...headers, "Retry-After": limit.unavailable ? "30" : retryAfterReset(limit.resetTime) },
  });
  try {
    // Scope snapshots by supplier account, without storing the account ID as a key.
    const account = createHash("sha256").update(process.env.CLUBKONNECT_USER_ID!.trim()).digest("hex").slice(0, 24);
    const snapshot = await readSharedSnapshot<SnapshotValue>({
      key: `clubkonnect:data:v1:${account}`,
      ttlMs: 60_000,
      refresh: async () => {
        const catalogue = await listClubkonnectCatalogue();
        return {
          value: { plans: catalogue.plans, skipped: catalogue.skipped, emptyNetworks: catalogue.emptyNetworks },
          checkedAt: new Date().toISOString(),
        };
      },
    });
    const catalogue = decodeSnapshot(snapshot.value);
    if (!catalogue || !catalogue.plans.length) {
      logger.warn("Mobile data catalogue unavailable", { reason: "snapshot_empty" });
      return NextResponse.json({ error: "The mobile data catalogue could not be loaded. Please retry." }, { status: 503, headers: { ...headers, "Retry-After": "30" } });
    }
    const age = Date.now() - Date.parse(snapshot.refreshedAt);
    if (!Number.isFinite(age) || age < -60_000 || age > MAX_SNAPSHOT_AGE_MS) {
      logger.warn("Mobile data catalogue unavailable", { reason: "snapshot_expired" });
      return NextResponse.json({ error: "The catalogue snapshot has expired. Please retry shortly." }, { status: 503, headers: { ...headers, "Retry-After": "30" } });
    }
    return NextResponse.json({
      plans: catalogue.plans,
      checkedAt: snapshot.refreshedAt,
      stale: snapshot.stale,
      priceKind: "supplier-published",
      // Told to the page, so it can say "some bundles are missing" rather than
      // presenting a partial read as the whole catalogue.
      incomplete: catalogue.skipped > 0 || catalogue.emptyNetworks.length > 0,
      skipped: catalogue.skipped,
      emptyNetworks: catalogue.emptyNetworks,
      checkoutAvailable: false,
      checkoutReason: "Purchase and delivery tracking are being connected. No wallet charge is available from this catalogue yet.",
    }, { headers });
  } catch (error) {
    // No supplier error text or request URL: either may contain credentials.
    if (error instanceof ClubkonnectAccountError) {
      /*
       * The account was answered and refused. Retrying costs the same refusal, so
       * the page must not invite it: this is reported as `unconfigured` — an
       * existing, non-retryable state in the customer's catalogue vocabulary —
       * with wording that describes what the customer can see. The supplier's own
       * status word goes to the log and to the diagnostics feed, never to a
       * customer, because it names the sourcing relationship.
       */
      logger.warn("Mobile data catalogue unavailable", { reason: "account_rejected", code: error.code });
      return NextResponse.json({ error: "Mobile data listings are not available right now.", code: "unconfigured" }, {
        status: 503, headers: { ...headers, "Retry-After": "60" },
      });
    }
    logger.warn("Mobile data catalogue unavailable", { reason: "snapshot_failed" });
    return NextResponse.json({ error: "The mobile data catalogue could not be loaded. Please retry." }, { status: 503, headers: { ...headers, "Retry-After": "30" } });
  }
}
