import "server-only";

import { financialActionsUnavailable } from "@/lib/platform/financial-environment";
import { fulfilmentIntent } from "@/lib/services/fulfillment";
import { isFleexaConfigured } from "@/lib/providers/fleexa";
import { isBitcallConfigured } from "@/lib/providers/bitcall";

/** A configured ordering path is not a guarantee of current stock or delivery. */
export function isNumberPlanOrderingConfigured(slug: string): boolean {
  if (financialActionsUnavailable()) return false;
  const intent = fulfilmentIntent(slug);
  if (!intent) return false;
  return intent.kind === "rental"
    ? isFleexaConfigured()
    : isBitcallConfigured();
}
