import "server-only";

import { financialActionsUnavailable } from "@/lib/financial-environment";
import { isBitcallConfigured } from "@/lib/bitcall";
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
  const preview = financialActionsUnavailable();
  const fleexa = !preview && isFleexaConfigured();
  const boosting = !preview && isSmmPanelConfigured();
  const accounts = !preview && isMarketplaceCheckoutConfigured();
  const esim = !preview && isBitcallConfigured();

  const entries: ServiceReadinessEntry[] = [
    {
      id: "verification",
      label: "App verification",
      state: "preview",
      detail: fleexa
        ? "Listings are readable, but each app still needs its own mapping before a code can be bought."
        : "App-specific listings are not currently available to order.",
    },
    {
      id: "social",
      label: "Social promotion",
      state: boosting ? "buy" : "paused",
      detail: boosting
        ? "Boosts are priced live and can be bought from your wallet."
        : preview ? "Ordering is unavailable in this environment." : "The boosting panel is not connected, so nothing here can be ordered or charged.",
    },
    {
      id: "numbers",
      label: "Number plans",
      state: fleexa ? "buy" : "paused",
      detail: fleexa
        ? "Single-use numbers and rentals are delivered automatically, and bulk orders buy the same units."
        : preview ? "Ordering is unavailable in this environment." : "Plans are catalogued with prices; ordering is not connected yet.",
    },
    {
      id: "esim",
      label: "eSIM",
      state: esim ? "buy" : "paused",
      detail: preview
        ? "eSIM ordering is unavailable in this environment."
        : esim
          ? "Travel data plans are read live from the network, priced in naira and issued as an activation code."
          : "eSIM ordering is not connected yet, so no plans can be ordered.",
    },
    {
      id: "proxies",
      label: "Proxies",
      state: "unavailable",
      detail: "Proxy ordering is not connected, so no proxy plan can be ordered or charged.",
    },
    {
      id: "email",
      label: "Email OTP",
      state: preview ? "paused" : "free",
      detail: preview
        ? "The temporary inbox is unavailable in this environment."
        : "The temporary inbox is free and needs no order. Paid inbox durations are not mapped yet.",
    },
    {
      id: "accounts",
      label: "Digital accounts",
      state: accounts ? "buy" : "paused",
      detail: accounts
        ? "Live marketplace listings can be bought from your wallet."
        : preview ? "Ordering is unavailable in this environment." : "Marketplace ordering is not connected, so there are no available listings to buy.",
    },
    {
      id: "subscriptions",
      label: "Subscriptions",
      state: "unavailable",
      detail: "Subscriptions cannot be ordered yet; plans and prices are not currently shown.",
    },
    {
      id: "data",
      label: "Mobile data",
      state: "unavailable",
      detail: "Mobile data ordering is not connected, so plans and prices are not currently shown.",
    },
    {
      id: "tools",
      label: "Order tools",
      state: fleexa ? "buy" : "paused",
      detail: fleexa
        ? "Bulk orders buy the same units as a single order. Eligible schedules run nightly."
        : preview ? "Ordering is unavailable in this environment." : "Bulk and scheduled tools need deliverable plans before they can place anything.",
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
        detail: "Ordering is not available for this category yet.",
      });
    }
  }

  return orderByReadiness(entries);
}

export function readinessFor(id: ServiceReadinessEntry["id"]): ServiceReadinessEntry | null {
  return readServiceReadiness().find((entry) => entry.id === id) ?? null;
}
