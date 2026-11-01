import "server-only";

/**
 * The values stored in `orders.provider`.
 *
 * This module is deliberately `server-only`. A provider name identifies where a
 * fulfilled order came from, and the owner's rule is that no customer ever
 * learns that — so these strings must not reach the browser. Client components
 * receive neutral, server-computed capability flags instead (for example
 * `refreshableCode` rather than the name of whatever delivered the code).
 *
 * Keeping them in one place also stops the literals from being re-typed and
 * drifting apart across queries and route handlers.
 */
export const ORDER_PROVIDERS = {
  /** Live verification delivered through the configured OTP adapter. */
  liveOtp: "fleexa",
  /**
   * Seeded by the in-memory preview store. Nothing was purchased or delivered and
   * there is no provider to ask for a release, so a refund of one correctly fails
   * to cancel upstream and flags reconciliation instead.
   */
  preview: "preview",
  /** Catalog account order placed through the routing layer. */
  accounts: "accounts",
  /** Digital gift cards and game vouchers delivered via FoxReload. */
  foxreload: "foxreload",
  /** Hand-prepared item waiting on the admin fulfilment queue. */
  manual: "manual",
  /** eSIM profile bought through the gateway and installed from a QR code. */
  bitcall: "bitcall",
} as const;

export type OrderProvider = (typeof ORDER_PROVIDERS)[keyof typeof ORDER_PROVIDERS];

export const LIVE_OTP_PROVIDER = ORDER_PROVIDERS.liveOtp;

/**
 * Every provider that can sell a verification number.
 *
 * Numbers are routed between suppliers, so "is this a number we can still ask
 * about" is a membership question, not an equality one. Written once here
 * because the order screen, the coverage page and the release path all need the
 * same answer, and three copies of an equality check is how one of them silently
 * stops refreshing.
 */
export const NUMBER_PROVIDERS: readonly string[] = [
  ORDER_PROVIDERS.liveOtp,
  ORDER_PROVIDERS.bitcall,
];

export function isNumberProvider(provider: string | null): boolean {
  return provider !== null && NUMBER_PROVIDERS.includes(provider);
}

/**
 * Does this order receive its code by being polled?
 *
 * The service check is not decoration: eSIM is bought through the same gateway,
 * so `provider === "bitcall"` alone would also match a profile that has no code
 * to poll for. Keeping the rule here — rather than in an equality test inside a
 * page — is what stops a fallback supplier from silently losing its refresh.
 */
export function pollsForCode(order: { service: string; provider: string | null }): boolean {
  return order.service === "numbers" && isNumberProvider(order.provider);
}
export const PREVIEW_PROVIDER = ORDER_PROVIDERS.preview;
export const ACCOUNTS_PROVIDER = ORDER_PROVIDERS.accounts;
export const FOXRELOAD_PROVIDER = ORDER_PROVIDERS.foxreload;
export const MANUAL_PROVIDER = ORDER_PROVIDERS.manual;
export const ESIM_PROVIDER = ORDER_PROVIDERS.bitcall;
