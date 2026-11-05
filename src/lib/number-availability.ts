import "server-only";

import { financialActionsUnavailable } from "@/lib/financial-environment";
import { fulfilmentIntent } from "@/lib/fulfillment";
import { isFleexaConfigured } from "@/lib/fleexa";
import { isBitcallConfigured } from "@/lib/bitcall";

/** A configured ordering path is not a guarantee of current stock or delivery. */
export function isNumberPlanOrderingConfigured(slug: string): boolean {
  if (financialActionsUnavailable()) return false;
  const intent = fulfilmentIntent(slug);
  if (!intent) return false;
  return intent.kind === "rental"
    ? isFleexaConfigured()
    : isFleexaConfigured() || isBitcallConfigured();
}
