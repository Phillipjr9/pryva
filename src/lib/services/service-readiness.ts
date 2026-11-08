import "server-only";

import { SERVICES, type SaleRule, type ServiceId, type SupplierSource } from "@/lib/services/registry";
import { financialActionsBlocked, supplierConfigured } from "@/lib/services/service-config";
import { orderByReadiness, type ServiceReadinessEntry, type ServiceState } from "@/lib/services/service-states";

/**
 * What each family can do in *this* deployment, and the sentence to say about it.
 *
 * Identity (id, label) comes from the registry, and the admin console reads the
 * same configuration through `service-config.ts`. What lives here is the verdict
 * rule and the customer-facing copy — the two things that genuinely differ per
 * family.
 *
 * `DETAIL` is a `Record<ServiceId, …>`, so adding a service without deciding what
 * to tell a customer about it is a compile error rather than a card that renders
 * with no state. That is how the old fallback loop failed: it silently labelled
 * anything missing "Not connected".
 */

type Context = {
  preview: boolean;
  supplier: (source: SupplierSource) => boolean;
};

type Copy = (context: Context) => string;

const DETAIL: Record<ServiceId, Copy> = {
  verification: ({ supplier }) =>
    supplier("bitcall")
      ? "Browse live app-specific number offers by destination. Each offer is checked again before purchase."
      : "Live app-specific offers are not connected, so verification orders cannot be placed.",
  social: ({ preview, supplier }) =>
    supplier("smm")
      ? "Boosts are priced live and can be bought from your wallet."
      : preview
        ? "Ordering is unavailable in this environment."
        : "The boosting panel is not connected, so nothing here can be ordered or charged.",
  numbers: ({ preview, supplier }) =>
    preview
      ? "Ordering is unavailable in this environment."
      : supplier("bitcall")
        ? "Single-use OTP numbers are checked against live offers before purchase. Rentals remain on a separate catalogue."
        : "Single-use OTP ordering is not connected, so those plans cannot be bought.",
  esim: ({ preview, supplier }) =>
    preview
      ? "eSIM ordering is unavailable in this environment."
      : supplier("bitcall")
        ? "Travel data plans are read live from the network, priced in naira and issued as an activation code."
        : "eSIM ordering is not connected yet, so no plans can be ordered.",
  proxies: ({ preview, supplier }) =>
    supplier("fleexa")
      ? "Proxy bandwidth plans are priced in naira and can be bought from your wallet."
      : preview
        ? "Ordering is unavailable in this environment."
        : "Proxy ordering is not connected yet, so no proxy plan can be ordered or charged.",
  email: ({ preview }) =>
    preview
      ? "The temporary inbox is unavailable in this environment."
      : "The temporary inbox is free and needs no order. Paid inbox durations are not mapped yet.",
  accounts: ({ preview, supplier }) =>
    supplier("marketplace")
      ? "Live marketplace listings can be bought from your wallet."
      : preview
        ? "Ordering is unavailable in this environment."
        : "Marketplace ordering is not connected, so there are no available listings to buy.",
  subscriptions: ({ preview, supplier }) =>
    supplier("fleexa")
      ? "Entertainment and tool subscriptions can be bought from your wallet."
      : preview
        ? "Ordering is unavailable in this environment."
        : "Subscriptions are not connected yet, so plans and prices are not currently shown.",
  data: ({ preview, supplier }) =>
    supplier("fleexa")
      ? "Mobile data plans for MTN, Airtel, Glo and 9mobile are priced in naira and can be bought from your wallet."
      : preview
        ? "Ordering is unavailable in this environment."
        : "Mobile data ordering is not connected yet, so plans and prices are not currently shown.",
  tools: ({ preview, supplier }) =>
    supplier("fleexa")
      ? "Bulk orders buy the same units as a single order. Eligible schedules run nightly."
      : preview
        ? "Ordering is unavailable in this environment."
        : "Bulk and scheduled tools need deliverable plans before they can place anything.",
};

/**
 * The verdict, from the sale rule alone.
 *
 * `preview` is the one state that is not about a supplier: the listings exist and
 * can be read, but there is no purchase path to open. A supplier-gated family is
 * `paused` — not `unavailable` — when the key is missing, because the catalogue
 * and the pricing are still real.
 */
function stateFor(sale: SaleRule, context: Context): ServiceState {
  switch (sale.kind) {
    case "catalogue":
      return "preview";
    case "free":
      return context.preview ? "paused" : "free";
    case "supplier":
      return context.supplier(sale.source) ? "buy" : "paused";
    case "none":
      return "unavailable";
  }
}

export function readServiceReadiness(): ServiceReadinessEntry[] {
  const preview = financialActionsBlocked();
  const context: Context = {
    preview,
    // A provider key is not the whole story: the preview database refuses
    // financial actions, so nothing can be bought there whatever is configured.
    supplier: (source) => !preview && supplierConfigured(source),
  };

  const entries: ServiceReadinessEntry[] = SERVICES.map((service) => ({
    id: service.id,
    label: service.label,
    state: stateFor(service.sale, context),
    detail: DETAIL[service.id](context),
  }));

  return orderByReadiness(entries);
}

export function readinessFor(id: ServiceId): ServiceReadinessEntry | null {
  return readServiceReadiness().find((entry) => entry.id === id) ?? null;
}
