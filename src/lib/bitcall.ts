/**
 * Bitcall gateway client (https://docs.bitcall.io).
 *
 * One gateway, one credential pair, three standalone products behind it:
 *   • OTP   — /v1/otp/*    rent numbers, receive one-time passcodes
 *   • eSIM  — /v1/esim/*   browse plans, buy, read back activation material
 *   • HLR   — /v1/hlr/*    Home Location Register lookups, number intelligence
 *
 * Auth is two single-valued headers sent as-is, with nothing to sign or time:
 * `x-key-id` (`ak_live_…` / `ak_test_…`) and `x-api-secret` (128 hex chars,
 * shown only when the key is issued or rotated and never readable again).
 *
 * Three properties of this contract drive the design here:
 *
 * 1. **The secret rides on every request.** So the base URL is pinned to
 *    api.bitcall.io and redirects are refused: a configurable or redirectable
 *    endpoint is a credential-exfiltration channel, not a convenience. For the
 *    same reason nothing here logs headers, and the docs' own warning is taken
 *    literally — anything that records request headers (proxy access logs, APM
 *    traces, shell history) captures a credential that then authorizes every
 *    endpoint the key can reach, purchases included.
 *
 * 2. **One error shape, thirteen codes.** `{error: {code, message, requestId,
 *    fields?}}`. Their instruction is to branch on `code` and never on
 *    `message`, because the code is contract and the message is prose. `code`
 *    is therefore preserved verbatim on BitcallError, `message` is not
 *    propagated, and `requestId` (equal to the `x-request-id` header) is kept
 *    because quoting it is how support identifies a request.
 *
 * 3. **Retrying an operation that spends money can spend it twice.** Their
 *    words: a purchase, a top-up and an OTP rental take effect on every call
 *    and there is no key or header that makes a retry safe. So nothing here
 *    retries automatically — not even the codes they classify as retryable —
 *    and `classifyRetry` is exported so a caller can decide with the outcome
 *    known. When an eSIM purchase's outcome is unknown, the documented recovery
 *    is to read `GET /v1/esim/orders` back, never to resend.
 *
 * eSIM field names below are parsed defensively across aliases: the endpoint
 * inventory and the plan vocabulary (coverage, allowance, validity, price) are
 * documented, but the exact JSON keys were not obtainable here and must be
 * confirmed against a live key before customer money moves.
 */

import "server-only";
import { createRateLimiter } from "@/lib/rate-limit";
import { readJsonWithLimit } from "@/lib/request-body";

const API_HOST = "api.bitcall.io";
const REQUEST_TIMEOUT_MS = 20_000;
// The gateway documents rate limits and answers 429 with Retry-After, but does
// not publish the quota here. A conservative shared budget leaves headroom;
// a 429 is still handled rather than assumed away.
const gatewayBudget = createRateLimiter({ windowMs: 60_000, maxRequests: 30 });

/** The gateway's whole error vocabulary. Thirteen codes; nothing else is returned. */
export type BitcallErrorCode =
  | "VALIDATION_ERROR" | "NOT_FOUND" | "CONFLICT"
  | "AUTHENTICATION_REQUIRED" | "INVALID_API_KEY"
  | "INSUFFICIENT_BALANCE" | "PRODUCT_UNAVAILABLE"
  | "CANCELLATION_NOT_AVAILABLE_YET" | "REACTIVATION_UNAVAILABLE"
  | "RATE_LIMITED" | "SERVICE_UNAVAILABLE" | "SERVICE_RESPONSE_INVALID" | "INTERNAL_ERROR"
  | "UNKNOWN";

/** How the gateway says an error should be handled. Branch on this, not on prose. */
export type BitcallRetryClass = "do_not_retry" | "retry_after_acting" | "retry_with_backoff" | "unknown";

const DO_NOT_RETRY: ReadonlySet<string> = new Set([
  "VALIDATION_ERROR", "NOT_FOUND", "CONFLICT",
  "AUTHENTICATION_REQUIRED", "INVALID_API_KEY", "REACTIVATION_UNAVAILABLE",
]);
const RETRY_AFTER_ACTING: ReadonlySet<string> = new Set([
  "INSUFFICIENT_BALANCE", "RATE_LIMITED", "CANCELLATION_NOT_AVAILABLE_YET",
]);
const RETRY_WITH_BACKOFF: ReadonlySet<string> = new Set([
  "SERVICE_UNAVAILABLE", "SERVICE_RESPONSE_INVALID", "INTERNAL_ERROR", "PRODUCT_UNAVAILABLE",
]);

export function classifyRetry(code: string | null | undefined): BitcallRetryClass {
  if (!code) return "unknown";
  if (DO_NOT_RETRY.has(code)) return "do_not_retry";
  if (RETRY_AFTER_ACTING.has(code)) return "retry_after_acting";
  if (RETRY_WITH_BACKOFF.has(code)) return "retry_with_backoff";
  return "unknown";
}

export class BitcallError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    /** The gateway's own code where it supplied one; otherwise a local one. */
    public readonly code: string,
    /** Equal to the `x-request-id` header. Quote it to their support. */
    public readonly requestId: string | null = null,
    /** Offending field paths on VALIDATION_ERROR. Never carries their values. */
    public readonly fields: string[] = [],
    public readonly retryAfterSeconds: number | null = null,
  ) {
    super(message);
    this.name = "BitcallError";
  }
}

/* ------------------------------------------------------------------ */
/* Configuration                                                        */
/* ------------------------------------------------------------------ */

export function bitcallKeyId(): string | null {
  const value = process.env.BITCALL_KEY_ID?.trim();
  return value ? value : null;
}

export function bitcallApiSecret(): string | null {
  const value = process.env.BITCALL_API_SECRET?.trim();
  return value ? value : null;
}

/** Both halves are required; one without the other cannot authenticate. */
export function isBitcallConfigured(): boolean {
  return bitcallKeyId() !== null && bitcallApiSecret() !== null;
}

/**
 * Whether the configured credential is a test or live key.
 *
 * Exposed because a key's environment decides whether a purchase spends real
 * money, and because reading a prefix is more reliable than a human label:
 * live credentials have been mistaken for test ones before in this project.
 * Returns "unknown" rather than guessing when the prefix is not recognized.
 */
export function bitcallKeyEnvironment(): "test" | "live" | "unknown" {
  const id = bitcallKeyId();
  if (!id) return "unknown";
  if (id.startsWith("ak_test_")) return "test";
  if (id.startsWith("ak_live_")) return "live";
  return "unknown";
}

/**
 * Pinned to the documented host. `BITCALL_API_URL` may override the deployment
 * but never the hostname, because the secret is sent as a header on every
 * request and a movable target would move the credential with it.
 */
function gatewayBase(): string {
  const raw = (process.env.BITCALL_API_URL?.trim() || `https://${API_HOST}`).replace(/\/+$/, "");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BitcallError("Invalid gateway configuration", 503, "INVALID_BASE_URL");
  }
  if (url.protocol !== "https:" || url.hostname !== API_HOST || url.username || url.password || url.search || url.hash) {
    throw new BitcallError("Invalid gateway configuration", 503, "INVALID_BASE_URL");
  }
  return url.origin;
}

/* ------------------------------------------------------------------ */
/* Tolerant extraction helpers                                          */
/* ------------------------------------------------------------------ */

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as UnknownRecord) : {};
}

function pickString(source: unknown, keys: string[]): string | null {
  const record = asRecord(source);
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

function pickNumber(source: unknown, keys: string[]): number | null {
  const record = asRecord(source);
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && /^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(value.trim())) {
      const parsed = Number(value.trim());
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function nonNegative(value: number | null): number | null {
  return value !== null && value >= 0 ? value : null;
}

function currencyCode(value: string | null): string | null {
  if (!value) return null;
  const code = value.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : null;
}

/** Accepts the documented `{data: [...]}` envelope or a bare array. */
function rowsFrom(payload: unknown, keys: string[] = ["data", "items", "plans", "orders", "profiles", "countries", "regions"]): UnknownRecord[] {
  if (Array.isArray(payload)) return payload.map(asRecord);
  const record = asRecord(payload);
  for (const key of keys) {
    if (Array.isArray(record[key])) return (record[key] as unknown[]).map(asRecord);
  }
  return [];
}

/* ------------------------------------------------------------------ */
/* Transport                                                            */
/* ------------------------------------------------------------------ */

async function gatewayFetch(
  method: "GET" | "POST",
  path: string,
  options: { query?: Record<string, string | number | undefined>; body?: Record<string, unknown> } = {},
): Promise<unknown> {
  const keyId = bitcallKeyId();
  const secret = bitcallApiSecret();
  if (!keyId) throw new BitcallError("BITCALL_KEY_ID is not configured", 503, "NO_KEY_ID");
  if (!secret) throw new BitcallError("BITCALL_API_SECRET is not configured", 503, "NO_API_SECRET");
  // Fail on a malformed secret here rather than as an opaque 401 later: the
  // gateway answers INVALID_API_KEY identically for a wrong secret, a revoked
  // key, an unknown key and a disallowed IP, so it cannot tell you which.
  if (!/^[0-9a-f]{128}$/i.test(secret)) {
    throw new BitcallError("BITCALL_API_SECRET is not a 128-character hex string", 503, "MALFORMED_SECRET");
  }
  const base = gatewayBase();

  const budget = await gatewayBudget("bitcall:shared-key-budget");
  if (budget.unavailable) throw new BitcallError("Gateway rate limit is unavailable", 503, "RATE_LIMIT_UNAVAILABLE");
  if (!budget.allowed) throw new BitcallError("Gateway rate limit reached", 429, "RATE_LIMITED");

  const url = new URL(base + path);
  for (const [name, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined) url.searchParams.set(name, String(value));
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      // The secret is a header. A redirect could carry it to another host.
      redirect: "error",
      headers: {
        "x-key-id": keyId,
        "x-api-secret": secret,
        Accept: "application/json",
        ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (error) {
    const isTimeout = error instanceof Error && error.name === "TimeoutError";
    throw new BitcallError(
      isTimeout ? "The gateway took too long to respond" : "Could not reach the gateway",
      502,
      "UPSTREAM_UNREACHABLE",
    );
  }

  const requestId = response.headers.get("x-request-id");
  const retryAfter = Number.parseFloat(response.headers.get("Retry-After") ?? "");

  let payload: unknown = null;
  if (response.status !== 204) {
    try {
      payload = await readJsonWithLimit(response, 4_194_304);
    } catch {
      // A body that is not JSON is a contract failure regardless of status.
      await response.body?.cancel().catch(() => {});
      throw new BitcallError("Invalid gateway response", 502, "SERVICE_RESPONSE_INVALID", requestId);
    }
  }

  const envelope = asRecord(payload);
  const errorBody = asRecord(envelope.error);
  const upstreamCode = pickString(errorBody, ["code"]);

  // Their error envelope can accompany a non-2xx status. Trust the code.
  if (!response.ok || upstreamCode) {
    const code = upstreamCode ?? (response.status === 429 ? "RATE_LIMITED" : "SERVICE_RESPONSE_INVALID");
    const fields = Array.isArray(errorBody.fields)
      ? (errorBody.fields as unknown[]).filter((f): f is string => typeof f === "string").slice(0, 20)
      : [];
    // Never propagate `message`: it is prose they may change, and it is not
    // ours to show a customer. Never log the request: its headers carry the
    // secret and an eSIM profile response carries a bearer credential.
    throw new BitcallError(
      "Gateway request failed",
      response.status,
      code,
      requestId ?? pickString(errorBody, ["requestId"]),
      fields,
      Number.isFinite(retryAfter) && retryAfter >= 0 ? retryAfter : null,
    );
  }

  return payload;
}

/* ------------------------------------------------------------------ */
/* Balance                                                              */
/* ------------------------------------------------------------------ */

export type BitcallBalance = { balance: number | null; currency: string | null };

/**
 * Reads the account balance every Bitcall product is charged against.
 *
 * Worth reading before a purchase rather than after. `INSUFFICIENT_BALANCE` is a
 * 409 that spends nothing, so an unfunded account is safe — but it is also the
 * failure that is easiest to prevent, and this is the only read-only way to
 * check. The response shape is parsed defensively: the endpoint is documented
 * but its fields were not published where they could be read.
 */
export async function getBitcallBalance(): Promise<BitcallBalance> {
  const payload = await gatewayFetch("GET", "/v1/balance");
  const envelope = asRecord(payload);
  const body = asRecord(envelope.data ?? envelope);
  return {
    balance: nonNegative(pickNumber(body, ["balance", "amount", "available", "availableBalance"])),
    currency: currencyCode(pickString(body, ["currency"])),
  };
}

/* ------------------------------------------------------------------ */
/* eSIM — catalog                                                       */
/* ------------------------------------------------------------------ */

export type BitcallEsimPlan = {
  /** `pln_`-prefixed. Sent back exactly as given when buying; a bare 24-hex id is refused. */
  planId: string | null;
  name: string | null;
  region: string | null;
  countries: string[];
  /** Data allowance, as the catalog reports it. Units are not assumed. */
  allowance: number | null;
  allowanceUnit: string | null;
  /** Validity period, as the catalog reports it. Units are not assumed. */
  validity: number | null;
  validityUnit: string | null;
  /**
   * The price the catalog returns. Their docs call it "your selling prices",
   * which does not settle whether it is our cost or a suggested retail price —
   * so it is surfaced raw and never marked up here.
   */
  price: number | null;
  currency: string | null;
};

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0).slice(0, 300);
}

export async function listBitcallEsimPlans(filter: { region?: string; country?: string } = {}): Promise<BitcallEsimPlan[]> {
  const payload = await gatewayFetch("GET", "/v1/esim/plans", { query: { region: filter.region, country: filter.country } });
  const plans: BitcallEsimPlan[] = [];
  const seen = new Set<string>();
  for (const row of rowsFrom(payload).slice(0, 2000)) {
    const planId = pickString(row, ["planId", "plan_id", "id"]);
    // Without a `pln_` reference the plan cannot be bought, so it cannot be listed.
    if (!planId || !planId.startsWith("pln_") || seen.has(planId)) continue;
    seen.add(planId);
    plans.push({
      planId,
      name: pickString(row, ["name", "title", "planName"]),
      region: pickString(row, ["region", "regionName"]),
      countries: stringList(row.countries ?? row.coverage ?? row.countryList),
      allowance: nonNegative(pickNumber(row, ["allowance", "data", "dataAllowance", "allowanceValue"])),
      allowanceUnit: pickString(row, ["allowanceUnit", "dataUnit", "unit"]),
      validity: nonNegative(pickNumber(row, ["validity", "validityDays", "days", "duration"])),
      validityUnit: pickString(row, ["validityUnit", "durationUnit"]),
      price: nonNegative(pickNumber(row, ["price", "amount", "retailPrice", "sellingPrice"])),
      currency: currencyCode(pickString(row, ["currency"])),
    });
  }
  return plans;
}

export async function listBitcallEsimCountries(): Promise<string[]> {
  const payload = await gatewayFetch("GET", "/v1/esim/countries");
  return rowsFrom(payload).map((row) => pickString(row, ["name", "country", "code"])).filter((v): v is string => v !== null);
}

export async function listBitcallEsimRegions(): Promise<string[]> {
  const payload = await gatewayFetch("GET", "/v1/esim/regions");
  return rowsFrom(payload).map((row) => pickString(row, ["name", "region", "code"])).filter((v): v is string => v !== null);
}

/* ------------------------------------------------------------------ */
/* eSIM — orders and profiles                                           */
/* ------------------------------------------------------------------ */

export const ESIM_ORDER_STATUSES = [
  "pending", "processing", "delivered", "partially_delivered",
  "failed", "refund_pending", "refunded", "cancelled", "requires_review",
] as const;

export type EsimOrderStatus = typeof ESIM_ORDER_STATUSES[number] | "unknown";

/** Only five statuses are accepted as list filters; the rest are read by id. */
const ESIM_LIST_FILTERS = new Set(["pending", "processing", "delivered", "refund_pending", "refunded"]);

export type BitcallEsimOrder = {
  orderId: string | null;
  status: EsimOrderStatus;
  /** ICCIDs produced once delivered. Each addresses one profile. */
  iccids: string[];
};

function orderStatus(value: string | null): EsimOrderStatus {
  if (!value) return "unknown";
  return (ESIM_ORDER_STATUSES as readonly string[]).includes(value) ? (value as EsimOrderStatus) : "unknown";
}

/**
 * Buys a plan. **Spends money on every call and has no idempotency key.**
 *
 * If this times out or fails with the outcome unknown, do not call it again:
 * read `listBitcallEsimOrders()` back and only retry once you know no order was
 * created. A blind resend is a second purchase.
 */
export async function buyBitcallEsimPlan(planId: string): Promise<BitcallEsimOrder> {
  const id = planId.trim();
  if (!id.startsWith("pln_") || id.length > 120) {
    throw new BitcallError("A plan reference must be the pln_ id from the catalog", 400, "VALIDATION_ERROR", null, ["body.planId"]);
  }
  // `planId` is the only accepted field; a stray property is rejected.
  const payload = await gatewayFetch("POST", "/v1/esim/orders", { body: { planId: id } });
  const envelope = asRecord(payload);
  const order = asRecord(envelope.data ?? envelope);
  return {
    orderId: pickString(order, ["orderId", "order_id", "id"]),
    status: orderStatus(pickString(order, ["status", "state"])),
    // A freshly created order is normally still provisioning, so this is usually
    // empty; the ICCIDs arrive when the order reaches `delivered`.
    iccids: extractIccids(order.esims),
  };
}

function extractIccids(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(asRecord).map((row) => pickString(row, ["iccid", "ICCID"])).filter((v): v is string => v !== null).slice(0, 50);
}

export async function getBitcallEsimOrder(orderId: string): Promise<BitcallEsimOrder> {
  const id = orderId.trim();
  if (!id || id.length > 120) throw new BitcallError("Invalid order reference", 400, "VALIDATION_ERROR", null, ["orderId"]);
  const payload = await gatewayFetch("GET", `/v1/esim/orders/${encodeURIComponent(id)}`);
  const envelope = asRecord(payload);
  const order = asRecord(envelope.data ?? envelope);
  return {
    orderId: pickString(order, ["orderId", "order_id", "id"]) ?? id,
    status: orderStatus(pickString(order, ["status", "state"])),
    iccids: extractIccids(order.esims),
  };
}

export async function listBitcallEsimOrders(status?: string): Promise<BitcallEsimOrder[]> {
  const filter = status?.trim();
  // An unaccepted filter is a 400 rather than an empty list, and an empty list
  // would read as "you have none" — so refuse it here instead.
  if (filter && !ESIM_LIST_FILTERS.has(filter)) {
    throw new BitcallError("That status cannot be used to filter the order list", 400, "VALIDATION_ERROR", null, ["query.status"]);
  }
  const payload = await gatewayFetch("GET", "/v1/esim/orders", { query: { status: filter } });
  return rowsFrom(payload).map((row) => ({
    orderId: pickString(row, ["orderId", "order_id", "id"]),
    status: orderStatus(pickString(row, ["status", "state"])),
    iccids: extractIccids(row.esims),
  }));
}

export type BitcallEsimProfile = {
  iccid: string;
  status: string | null;
  /**
   * Bearer credential. `"LPA:1$…"` — the QR payload itself; they host no image,
   * so render it client-side. Anyone holding it can install the eSIM. Never log
   * it, never put it in an error message, and only ever return it to the
   * authenticated owner of the order that produced it.
   */
  activationCode: string | null;
  /** One-tap install link for iOS. Same handling as the activation code. */
  appleInstallUrl: string | null;
};

export async function getBitcallEsimProfile(iccid: string): Promise<BitcallEsimProfile> {
  const id = iccid.trim();
  if (!id || id.length > 40) throw new BitcallError("Invalid ICCID", 400, "VALIDATION_ERROR", null, ["iccid"]);
  const payload = await gatewayFetch("GET", `/v1/esim/profiles/${encodeURIComponent(id)}`);
  const envelope = asRecord(payload);
  const profile = asRecord(envelope.data ?? envelope);
  return {
    iccid: id,
    status: pickString(profile, ["status", "state"]),
    activationCode: pickString(profile, ["activationCode", "activation_code", "lpa"]),
    appleInstallUrl: pickString(profile, ["appleInstallUrl", "apple_install_url"]),
  };
}
