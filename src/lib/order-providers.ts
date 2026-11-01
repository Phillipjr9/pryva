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
export const PREVIEW_PROVIDER = ORDER_PROVIDERS.preview;
export const ACCOUNTS_PROVIDER = ORDER_PROVIDERS.accounts;
export const FOXRELOAD_PROVIDER = ORDER_PROVIDERS.foxreload;
export const MANUAL_PROVIDER = ORDER_PROVIDERS.manual;
export const ESIM_PROVIDER = ORDER_PROVIDERS.bitcall;
