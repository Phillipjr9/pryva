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
  /** Produced by the in-memory demo: nothing was purchased or delivered. */
  simulated: "simulated",
  /** Catalog account order placed through the routing layer. */
  accounts: "accounts",
  /** Hand-prepared item waiting on the admin fulfilment queue. */
  manual: "manual",
} as const;

export type OrderProvider = (typeof ORDER_PROVIDERS)[keyof typeof ORDER_PROVIDERS];

export const LIVE_OTP_PROVIDER = ORDER_PROVIDERS.liveOtp;
export const SIMULATED_PROVIDER = ORDER_PROVIDERS.simulated;
export const ACCOUNTS_PROVIDER = ORDER_PROVIDERS.accounts;
export const MANUAL_PROVIDER = ORDER_PROVIDERS.manual;
