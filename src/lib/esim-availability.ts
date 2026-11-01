import "server-only";

import { isBitcallConfigured } from "@/lib/bitcall";

/**
 * Whether eSIM ordering is available on this deployment.
 *
 * The name is deliberately neutral: pages import this instead of the gateway
 * client, because a customer-facing file that names the supplier fails the
 * secrecy scan — and rightly so, the import path is the leak.
 */
export function isEsimOrderingAvailable(): boolean {
  return isBitcallConfigured();
}
