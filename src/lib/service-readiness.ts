import "server-only";

import { isPreviewDatabase } from "@/lib/demo-policy";
import { isFleexaConfigured } from "@/lib/fleexa";
import { isMarketplaceCheckoutConfigured } from "@/lib/marketplace-policy";
import { isSmmPanelConfigured } from "@/lib/smm-panel";
import { EXPLORER_CATEGORIES } from "@/lib/service-explorer";
import { orderByReadiness, type ServiceReadinessEntry } from "@/lib/service-states";

/**
 * The single place that decides what each service family can do.
 *
 * Every branch reads the same configuration the checkout reads, so the hub
 * cannot advertise something the route would refuse. It is deliberately
 * server-only: `isFleexaConfigured()` and friends answer questions about keys.
 *
 * The four verdicts matter because "not available" covered three very different
 * situations before: a catalogue that needs a key, a catalogue that was never
 * mapped, and a product with no supplier at all. They need different answers —
 * a key, a mapping, or a decision not to sell it.
 */
export function readServiceReadiness(): ServiceReadinessEntry[] {
  const preview = isPreviewDatabase();
  const fleexa = isFleexaConfigured();
  const boosting = isSmmPanelConfigured();
  const accounts = isMarketplaceCheckoutConfigured();

  const entries: ServiceReadinessEntry[] = [
    {
      id: "verification",
      label: "App verification",
      state: "preview",
      detail: fleexa
        ? "Supplier listings are readable, but each app still needs its own mapping before a code can be bought."
        : "Platform examples only. Per-app ordering needs a supplier key and a service mapping.",
    },
    {
      id: "social",
      label: "Social promotion",
      state: boosting ? "buy" : "paused",
      detail: boosting
        ? "Boosts are priced live and can be bought from your wallet."
        : "The boosting panel is not connected, so nothing here can be ordered or charged.",
    },
    {
      id: "numbers",
      label: "Number plans",
      state: fleexa ? "buy" : "paused",
      detail: fleexa
        ? "Single-use numbers and rentals are delivered automatically, and bulk orders buy the same units."
        : "Plans are catalogued with prices; ordering opens when the number supplier is connected.",
    },
    {
      id: "esim",
      label: "eSIM",
      state: "preview",
      detail: "Travel plans are listed for browsing. Checkout is closed until supplier pricing is confirmed.",
    },
    {
      id: "proxies",
      label: "Proxies",
      state: "unavailable",
      detail: "No proxy supplier is connected, so no proxy plan can be ordered or charged.",
    },
    {
      id: "email",
      label: "Email OTP",
      state: preview ? "paused" : "free",
      detail: preview
        ? "The free temporary inbox needs the persistent database; this preview cannot issue one."
        : "The temporary inbox is free and needs no order. Paid inbox durations are not mapped yet.",
    },
    {
      id: "accounts",
      label: "Digital accounts",
      state: accounts ? "buy" : "paused",
      detail: accounts
        ? "Live marketplace listings can be bought from your wallet."
        : "The marketplace is browsable when a supplier key is set; without one it has nothing to show.",
    },
    {
      id: "subscriptions",
      label: "Subscriptions",
      state: "unavailable",
      detail: "No subscription supplier is connected. Prices here are examples, not offers.",
    },
    {
      id: "data",
      label: "Mobile data",
      state: "unavailable",
      detail: "Data plans are catalogued, but no supplier is connected to deliver them.",
    },
    {
      id: "tools",
      label: "Order tools",
      state: fleexa ? "buy" : "paused",
      detail: fleexa
        ? "Bulk orders buy and deliver the same units as a single order. Scheduled ordering is not launched yet."
        : "Bulk and scheduled tools need deliverable plans before they can place anything.",
    },
  ];

  // Every category must have a verdict. A missing one would silently render as
  // "no state", which is how a new category ends up unlabelled.
  const covered = new Set(entries.map((entry) => entry.id));
  for (const category of EXPLORER_CATEGORIES) {
    if (!covered.has(category.id)) {
      entries.push({
        id: category.id,
        label: category.label,
        state: "unavailable",
        detail: "No supplier integration exists for this category yet.",
      });
    }
  }

  return orderByReadiness(entries);
}

export function readinessFor(id: ServiceReadinessEntry["id"]): ServiceReadinessEntry | null {
  return readServiceReadiness().find((entry) => entry.id === id) ?? null;
}
