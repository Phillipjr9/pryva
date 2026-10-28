import { findPlan, type Plan } from "@/lib/catalog";
import { isPreviewDatabase } from "@/lib/demo-policy";
import { demoService } from "@/lib/demo-services";
import { canPreviewPlan, explorerCategory, planCountry } from "@/lib/service-explorer";

/**
 * Where a catalog plan should take somebody after they sign in.
 *
 * The marketing pages link "Get started" as `/signup?plan=<slug>`. That query
 * used to be dropped on the floor: signup only understood `next`, so a visitor
 * who picked a specific plan landed on the generic dashboard with no trace of
 * their choice. This maps a plan slug to a destination that actually exists in
 * the current environment, and returns `null` when it cannot be honoured so the
 * caller can fall back to its default instead of inventing a broken link.
 *
 * Server-only: it reads the environment and the (server-side) demo catalog.
 */
export function planDestination(slug: unknown): string | null {
  if (typeof slug !== "string" || slug.length === 0 || slug.length > 80) return null;
  const plan: Plan | undefined = findPlan(slug);
  if (!plan) return null;

  // Only these four services have catalog plans with a hub category; anything
  // else gets the hub root rather than a category that does not exist.
  const category = explorerCategory(plan.service === "email-otp" ? "email" : plan.service);
  const hub = `/dashboard/services?category=${encodeURIComponent(category)}`;
  const country = planCountry(plan);
  if (!country) return hub;

  if (isPreviewDatabase()) {
    // Preview shows simulated items. Only link the demo detail page when that
    // exact item resolves — `demoService()` is the same guard the page uses, so
    // this can never produce a 404.
    const itemId = `plan-${plan.slug}`;
    if (canPreviewPlan(plan, country.code) && demoService(itemId, country.code)) {
      return `/dashboard/services/demo/${encodeURIComponent(itemId)}?country=${country.code}`;
    }
    return `/dashboard/services?country=${country.code}&category=${encodeURIComponent(category)}`;
  }

  return canPreviewPlan(plan, country.code)
    ? `/dashboard/services/plan/${encodeURIComponent(plan.slug)}?country=${country.code}`
    : hub;
}
