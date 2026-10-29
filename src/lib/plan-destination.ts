import { findPlan, type Plan } from "@/lib/catalog";
import { canPreviewPlan, explorerCategory, planCountry } from "@/lib/service-explorer";

/**
 * Where a catalog plan should take somebody after they sign in.
 *
 * The marketing pages link "Get started" as `/signup?plan=<slug>`. That query
 * used to be dropped on the floor: signup only understood `next`, so a visitor
 * who picked a specific plan landed on the generic dashboard with no trace of
 * their choice. This maps a plan slug to a destination that actually exists, and returns `null` when it cannot be honoured so the
 * caller can fall back to its default instead of inventing a broken link.
 *
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

  return canPreviewPlan(plan, country.code)
    ? `/dashboard/services/plan/${encodeURIComponent(plan.slug)}?country=${country.code}`
    : hub;
}
