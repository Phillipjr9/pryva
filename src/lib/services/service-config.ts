import "server-only";

import { financialActionsUnavailable } from "@/lib/platform/financial-environment";
import { PROVIDERS } from "@/lib/providers";
import { isMarketplaceCheckoutConfigured } from "@/lib/services/accounts/marketplace-policy";
import {
  laneById,
  serviceById,
  type LaneId,
  type ServiceId,
  type SupplierSource,
} from "@/lib/services/registry";

/**
 * The one place that asks the environment whether a supplier is connected.
 *
 * Before this module the question was answered in three: the hub derived it for
 * customer copy, the admin coverage page re-derived it with its own `switch`,
 * and the readiness fallback guessed. A new supplier therefore had to be added
 * to each, and forgetting one produced a page that contradicted the checkout.
 *
 * It is deliberately server-only and deliberately dumb: it reads credentials and
 * knows nothing about copy, verdicts or layouts.
 */

const SUPPLIERS: Record<SupplierSource, () => boolean> = {
  fleexa: PROVIDERS.fleexa.configured,
  smm: PROVIDERS.smm.configured,
  bitcall: PROVIDERS.bitcall.configured,
  /**
   * Not a single adapter: the marketplace is a policy over two feeds and the
   * hand-prepared queue, and the gate is the policy rather than either feed. It
   * stays explicit for that reason.
   */
  marketplace: isMarketplaceCheckoutConfigured,
};

/** Is the credential for this supplier present? No preview logic, no copy. */
export function supplierConfigured(source: SupplierSource): boolean {
  return SUPPLIERS[source]();
}

/**
 * Can this family take money at all, ignoring the preview environment?
 *
 * `catalogue` is true because browsing is real; `none` is false because there is
 * nothing behind it. Used by the operator console, which reports what is wired
 * rather than what the current deployment allows.
 */
export function serviceConfigured(id: ServiceId): boolean {
  // A general supplier credential does not implement these delivery paths.
  if (id === "data" || id === "subscriptions" || id === "proxies") return false;
  const { sale } = serviceById(id);
  switch (sale.kind) {
    case "supplier":
      return supplierConfigured(sale.source);
    case "free":
    case "catalogue":
      return true;
    case "none":
      return false;
  }
}

/** The lane's verdict reads its declared service, never a second list. */
export function laneConfigured(id: LaneId): boolean {
  return serviceConfigured(laneById(id).configuredBy);
}

/** Whether financial actions run in this deployment; the hub's preview gate. */
export function financialActionsBlocked(): boolean {
  return financialActionsUnavailable();
}
