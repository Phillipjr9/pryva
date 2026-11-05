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

/**
 * Codes that mean "the account behind this supplier cannot pay right now".
 *
 * Shared so an adapter can raise one and a caller can recognise it without
 * importing every adapter's vocabulary.
 */
const FUNDING_CODES: ReadonlySet<string> = new Set([
  "INSUFFICIENT_BALANCE",
  "INSUFFICIENT_FUNDS",
  "NO_BALANCE",
  "LOW_BALANCE",
  "PAYMENT_REQUIRED",
  "ACCOUNT_UNFUNDED",
]);

/**
 * Did this failure mean "we are out of funds" rather than "the supplier is down"?
 *
 * The distinction is not cosmetic. An outage is transient — telling a customer to
 * retry is honest, and the retry may work. An unfunded account is not: no amount
 * of retrying refills it, so every retry is a promise the shop cannot keep. It is
 * also the failure that is cheapest to prevent, which is why the adapters raise it
 * as a 402 instead of folding it into a generic upstream error.
 */
export function isFundingFailure(error: unknown): boolean {
  if (!isProviderError(error)) return false;
  return error.status === 402 || FUNDING_CODES.has(error.code);
}

/**
 * Does an upstream refusal say, in its own words, that the account cannot pay?
 *
 * Suppliers refuse in prose far more often than in status codes — an unfunded
 * account is routinely a 200 with an error field, or a 400 reading "insufficient
 * balance". Adapters match the text here and re-raise a coded 402; the text
 * itself is never propagated, so matching is the only use it gets.
 */
export function looksLikeFundingRefusal(text: unknown): boolean {
  if (typeof text !== "string" || !text) return false;
  // An authentication complaint is a credential problem even when the same
  // sentence happens to mention a balance ("Invalid API key. Balance: 0").
  if (/api[\s_-]?key|unauthori[sz]ed|forbidden|invalid\s+(api\s+)?(key|token|secret)|authentication/i.test(text)) return false;
  return /\binsufficient\s+(balance|funds?|credit)|\bnot\s+enough\s+(balance|funds?|credit)|\bno\s+(available\s+)?(balance|funds)|\bbalance\b[^.]{0,20}\b(low|insufficient|empty|zero|exhausted)|\bunfunded\b|\bout\s+of\s+(balance|funds|credit)|\badd\s+funds\b|\btop\s*up\b|\brecharge\b/i.test(text);
}
