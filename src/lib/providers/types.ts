/**
 * The supplier boundary.
 *
 * Each adapter keeps its own client, its own parsing and its own failure codes —
 * those really do differ. What was missing was the part they share: a name for
 * "which supplier failed", one error type every caller can catch, and a
 * descriptor an operator page can enumerate without importing six modules and
 * remembering what each one exposes.
 *
 * Supplier names are internal. `label` here is for operator tooling only; the
 * customer-facing surface gets capability flags from `order-providers.ts`, which
 * is where the rule about never naming a supplier lives.
 */

export const PROVIDER_IDS = [
  "fleexa",
  "bitcall",
  "foxreload",
  "accszone",
  "bulkacc",
  "smm",
  "tempmail",
] as const;

export type ProviderId = (typeof PROVIDER_IDS)[number];

export type ProviderDescriptor = {
  id: ProviderId;
  /** Internal name for diagnostics. Never rendered on a customer page. */
  label: string;
  /** Is the credential present? Reading it must not throw. */
  configured: () => boolean;
  /** Which order tags this supplier can deliver, for operator reports. */
  supplies: readonly string[];
};

/**
 * Base class for every supplier failure.
 *
 * `status` follows HTTP so a route can pass it through, and `code` is the
 * adapter's own vocabulary. Callers that need to tell "refused" from "we do not
 * know" still ask the adapter: ambiguity is supplier-specific by nature and is
 * not papered over here.
 */
export class ProviderError extends Error {
  readonly status: number;
  readonly code: string;
  readonly provider: ProviderId;

  constructor(
    message: string,
    options: { provider: ProviderId; status?: number; code?: string },
  ) {
    super(message);
    this.name = "ProviderError";
    this.provider = options.provider;
    this.status = options.status ?? 502;
    this.code = options.code ?? "PROVIDER_ERROR";
  }
}

export function isProviderError(error: unknown): error is ProviderError {
  return error instanceof ProviderError;
}

/**
 * Did this failure happen before anything could have been bought?
 *
 * The distinction matters at the checkout: a request that never left, or was
 * refused outright, leaves nothing to release; an ambiguous one may have bought
 * something. Adapters answer the ambiguous half; this answers the safe half.
 */
export function isRefusal(error: unknown): boolean {
  return isProviderError(error) && (error.status === 400 || error.status === 402 || error.status === 404);
}
