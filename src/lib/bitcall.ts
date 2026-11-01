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

/**
 * Codes that mean the request was refused *before* it could execute, so no money
 * moved. Their gateway check order is: headers → key → IP → secret → account
 * standing → product enabled → rate limit → schema. Everything in this set is
 * rejected at or before that pipeline, and their docs state the charge did not
 * happen for the ones that spend (`INSUFFICIENT_BALANCE`: "Nothing was charged,
 * so no number was rented").
 */
const DEFINITIVELY_NOT_EXECUTED: ReadonlySet<string> = new Set([
  // Gateway refusals.
  "VALIDATION_ERROR", "NOT_FOUND", "CONFLICT",
  "AUTHENTICATION_REQUIRED", "INVALID_API_KEY",
  "INSUFFICIENT_BALANCE", "PRODUCT_UNAVAILABLE",
  "CANCELLATION_NOT_AVAILABLE_YET", "REACTIVATION_UNAVAILABLE",
  "RATE_LIMITED",
  // Local refusals: the request never left this process.
  "NO_KEY_ID", "NO_API_SECRET", "MALFORMED_SECRET", "INVALID_BASE_URL", "LOCAL_RATE_BUDGET",
]);

/**
 * Whether a failure leaves the outcome of a **money-spending** call unknown.
 *
 * `classifyRetry` answers "may I try again". This answers a different and more
 * dangerous question: "did the thing I asked for possibly already happen". The
 * two do not agree, and treating them as the same is how a purchase happens
 * twice — their docs are blunt about it: *"Retrying an operation that spends
 * money can spend it twice… no key or header makes a retry safe"*, and for OTP
 * specifically *"Each call to this endpoint rents a number and charges for it.
 * If it times out or fails without a clear answer, do not resend it — read your
 * orders back to see whether one was created."*
 *
 * So `SERVICE_UNAVAILABLE` is classified `retry_with_backoff` — correct for a
 * read — yet is ambiguous here, because a 503 can arrive after the operation
 * began. Conversely `PRODUCT_UNAVAILABLE` is also `retry_with_backoff` but is
 * *not* ambiguous: nothing was rented.
 *
 * When this returns true the only safe next step is reconciliation — read the
 * activations or orders collection back and check whether one was created —
 * never a resend, and never an automatic failover to another supplier. Anything
 * that is not a `BitcallError` is treated as ambiguous, because an unexpected
 * throw is precisely the case where what happened is unknown.
 */
export function isAmbiguousBitcallOutcome(error: unknown): boolean {
  if (!(error instanceof BitcallError)) return true;
  return !DEFINITIVELY_NOT_EXECUTED.has(error.code);
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
  // Distinct from the gateway's own `RATE_LIMITED`: this refusal happens here,
  // so the request never left the process and nothing upstream can have executed.
  // Collapsing the two would make "did my purchase go out?" unanswerable, which
  // is exactly what isAmbiguousBitcallOutcome has to decide.
  if (!budget.allowed) throw new BitcallError("Gateway rate limit reached", 429, "LOCAL_RATE_BUDGET");

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

/**
 * Coverage, however the catalog chooses to state it.
 *
 * Plans used to read coverage from array fields only (`countries`, `coverage`,
 * `countryList`). A single-destination plan very often names its one country in a
 * scalar field instead, which parsed to no coverage at all — and a plan with no
 * coverage is shown under no destination. The effect is the one the owner asked
 * about: a catalogue of hundreds of plans renders as a handful of listings, and
 * only for destinations that happened to be written as an array or a global plan.
 *
 * Accepting the scalar forms is not guessing coverage: every value here is a
 * country the catalog itself named. Anything it does not name still counts as no
 * coverage, and is listed for no destination.
 */
function coverageList(row: Record<string, unknown>): string[] {
  for (const value of [row.countries, row.coveredCountries, row.countryList, row.coverage, row.destinations]) {
    if (Array.isArray(value)) return stringList(value);
  }
  const parts: string[] = [];
  for (const key of [
    "country", "countryCode", "country_code", "destination", "destinations",
    "coverage", "countries", "coveredCountries", "countryList",
  ]) {
    const value = row[key];
    if (typeof value !== "string") continue;
    for (const piece of value.split(/[,|;/]/)) {
      const trimmed = piece.trim();
      if (trimmed) parts.push(trimmed);
    }
  }
  return [...new Set(parts)].slice(0, 300);
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
      countries: coverageList(row),
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

/**
 * One profile, parsed from a gateway row. Shared by the single-profile read and
 * the collection so the two cannot drift apart on field spelling.
 */
function parseEsimProfile(row: unknown, fallbackIccid: string | null): BitcallEsimProfile {
  const profile = asRecord(row);
  return {
    iccid: pickString(profile, ["iccid", "ICCID", "iccId"]) ?? fallbackIccid ?? "",
    status: pickString(profile, ["status", "state"]),
    activationCode: pickString(profile, ["activationCode", "activation_code", "lpa"]),
    appleInstallUrl: pickString(profile, ["appleInstallUrl", "apple_install_url"]),
  };
}

export async function getBitcallEsimProfile(iccid: string): Promise<BitcallEsimProfile> {
  const id = iccid.trim();
  if (!id || id.length > 40) throw new BitcallError("Invalid ICCID", 400, "VALIDATION_ERROR", null, ["iccid"]);
  const payload = await gatewayFetch("GET", `/v1/esim/profiles/${encodeURIComponent(id)}`);
  const envelope = asRecord(payload);
  return parseEsimProfile(envelope.data ?? envelope, id);
}

/**
 * Every eSIM profile the account holds, across all orders.
 *
 * This exists because their docs are explicit that a lost activation credential
 * is recoverable: "A client that lost one can read it again from the profile."
 * Without this call the only route back to a credential is through the order
 * that produced it, which means a customer who lost a code after the order
 * scrolled out of view has no way to recover it — and re-buying would charge
 * again for something they already own.
 *
 * Rows carry the same bearer credential as the single-profile read, so the same
 * handling applies: never logged, never in an error message, only ever returned
 * to the authenticated owner.
 */
export async function listBitcallEsimProfiles(): Promise<BitcallEsimProfile[]> {
  const payload = await gatewayFetch("GET", "/v1/esim/profiles");
  const profiles: BitcallEsimProfile[] = [];
  const seen = new Set<string>();
  for (const row of rowsFrom(payload).slice(0, 2000)) {
    const profile = parseEsimProfile(row, null);
    // A profile is addressed by its ICCID. Without one it cannot be re-read or
    // matched to an order, so it is not a usable row.
    if (!profile.iccid || seen.has(profile.iccid)) continue;
    seen.add(profile.iccid);
    profiles.push(profile);
  }
  return profiles;
}

/* ------------------------------------------------------------------ */
/* OTP — catalog                                                        */
/* ------------------------------------------------------------------ */

/**
 * One offer: a single service in a single country, from a single pool.
 *
 * The same service and country appear once per pool that sells it, each at its
 * own price, stock and measured success rate. Those two extra fields are why
 * this catalog is worth routing on rather than just listing: for a verification
 * product the success rate *is* the product, and a number that never receives
 * the code is a refund plus a support ticket.
 */
export type BitcallOtpOffer = {
  /**
   * Opaque. "Do not assemble one yourself — the segments are spelled the way the
   * selling side spells them, and a value you build will not resolve." It happens
   * to read as pool-country-service; that shape is a coincidence of their naming
   * and must never be parsed, generated or validated against.
   */
  serviceId: string | null;
  /** The price this offer charges. Units and cost-vs-retail are not assumed here. */
  price: number | null;
  currency: string | null;
  /** Numbers in stock. Offers with none are omitted by the gateway entirely. */
  availableCount: number | null;
  /**
   * Measured success rate, surfaced exactly as reported. Their example shows `87`
   * alongside a price of `0.42`, which reads as a percentage, but the scale is not
   * documented — so it is not normalised. Guessing 0–1 versus 0–100 would silently
   * invert any routing decision built on it.
   */
  successRate: number | null;
};

export type BitcallOtpService = {
  name: string | null;
  slug: string | null;
  countryCode: string | null;
  offers: BitcallOtpOffer[];
};

function parseOtpOffer(row: unknown): BitcallOtpOffer | null {
  const offer = asRecord(row);
  // Without a serviceId the offer cannot be bought, so it cannot be offered.
  const serviceId = pickString(offer, ["serviceId", "service_id", "id"]);
  if (!serviceId) return null;
  return {
    serviceId,
    price: nonNegative(pickNumber(offer, ["price", "amount", "cost"])),
    currency: currencyCode(pickString(offer, ["currency"])),
    availableCount: nonNegative(pickNumber(offer, ["availableCount", "available_count", "available", "stock", "count"])),
    successRate: nonNegative(pickNumber(offer, ["successRate", "success_rate", "success"])),
  };
}

function parseOtpService(row: unknown): BitcallOtpService {
  const service = asRecord(row);
  const pools = Array.isArray(service.pools) ? service.pools : [];
  const offers: BitcallOtpOffer[] = [];
  const seen = new Set<string>();
  for (const entry of pools.slice(0, 200)) {
    const offer = parseOtpOffer(entry);
    if (!offer?.serviceId || seen.has(offer.serviceId)) continue;
    seen.add(offer.serviceId);
    offers.push(offer);
  }
  return {
    name: pickString(service, ["name", "title", "serviceName"]),
    slug: pickString(service, ["slug", "serviceSlug"]),
    countryCode: pickString(service, ["country_code", "countryCode", "country"]),
    offers,
  };
}

/**
 * The whole OTP catalog, filtered. One collection — there is no per-country
 * sub-resource, so country is a query parameter rather than a path.
 */
export async function listBitcallOtpServices(
  filter: { q?: string; countryCode?: string; pool?: string } = {},
): Promise<BitcallOtpService[]> {
  const payload = await gatewayFetch("GET", "/v1/otp/services", {
    query: { q: filter.q, country_code: filter.countryCode, pool: filter.pool },
  });
  return rowsFrom(payload).slice(0, 2000).map(parseOtpService).filter((service) => service.offers.length > 0);
}

/**
 * Offers for one service, addressed either by a `serviceId` the catalog published
 * (matched exactly; `404` when no such offer is sellable) or by free-text name
 * (matched case-insensitively against a name or slug).
 *
 * The two cases behave differently on a miss, and the difference is load-bearing:
 * **a name that matches nothing returns an empty `data` array with `meta.total` 0,
 * not a `404`** — "no result is a result". A sold-out offer is omitted from the
 * catalog, so a `serviceId` that was sellable yesterday can `404` today without
 * anything being wrong.
 */
export async function findBitcallOtpService(reference: string): Promise<BitcallOtpService[]> {
  const ref = reference.trim();
  if (!ref || ref.length > 200) {
    throw new BitcallError("Invalid service reference", 400, "VALIDATION_ERROR", null, ["reference"]);
  }
  const payload = await gatewayFetch("GET", `/v1/otp/services/${encodeURIComponent(ref)}`);
  return rowsFrom(payload).slice(0, 2000).map(parseOtpService).filter((service) => service.offers.length > 0);
}

export async function listBitcallOtpCountries(): Promise<string[]> {
  const payload = await gatewayFetch("GET", "/v1/otp/countries");
  const codes = new Set<string>();
  for (const row of rowsFrom(payload, ["data", "countries", "items"]).slice(0, 1000)) {
    const code = pickString(row, ["country_code", "countryCode", "code", "country"]);
    if (code) codes.add(code.trim().toUpperCase());
    else {
      // A bare array of strings is the other plausible shape.
      const raw = Object.values(row).find((value): value is string => typeof value === "string");
      if (raw?.trim()) codes.add(raw.trim().toUpperCase());
    }
  }
  return [...codes];
}

/**
 * Pools — a grouping of numbers, **not something you rent directly**. Offers are
 * what you rent; this exists to supply the `pool` filter on the catalog.
 */
export async function listBitcallOtpPools(): Promise<string[]> {
  const payload = await gatewayFetch("GET", "/v1/otp/pools");
  const pools = new Set<string>();
  for (const row of rowsFrom(payload, ["data", "pools", "items"]).slice(0, 1000)) {
    const pool = pickString(row, ["pool", "name", "id", "code"]);
    if (pool?.trim()) pools.add(pool.trim());
  }
  return [...pools];
}

/* ------------------------------------------------------------------ */
/* OTP — activations                                                    */
/* ------------------------------------------------------------------ */

/**
 * The whole status vocabulary. Anything unmappable is reported as `unknown`
 * rather than passed through, matching their own behaviour and keeping an
 * internal provider name from reaching a customer.
 */
export const OTP_ACTIVATION_STATUSES = [
  "waiting", "activating", "received", "completed", "expired", "cancelled", "refunded", "unknown",
] as const;

export type OtpActivationStatus = (typeof OTP_ACTIVATION_STATUSES)[number];

export type BitcallOtpActivation = {
  activationId: string | null;
  /** The rented number. Only ever returned to the authenticated owner. */
  phoneNumber: string | null;
  /** The code, once status is `received`. Null before that. */
  code: string | null;
  price: number | null;
  currency: string | null;
  status: OtpActivationStatus;
  /** Echoed back so a later order shows which offer it was placed against. */
  serviceId: string | null;
  /**
   * Use these rather than inferring from status — but they are **not equally
   * strong**. `canResend` tracks a local, time-based cooldown and is reliable.
   * `canReactivate` reflects the provider's ~10 minute window as it stood when
   * the flag was computed, and that window can close before you act, so a
   * reactivation can still be refused with `409 REACTIVATION_UNAVAILABLE`.
   * Treat it as "worth trying", never as "will succeed".
   */
  actions: { canResend: boolean; canReactivate: boolean };
};

function normalizeOtpStatus(value: string | null): OtpActivationStatus {
  if (!value) return "unknown";
  const lowered = value.trim().toLowerCase();
  return (OTP_ACTIVATION_STATUSES as readonly string[]).includes(lowered)
    ? (lowered as OtpActivationStatus)
    : "unknown";
}

function parseOtpActivation(row: unknown, fallbackId: string | null): BitcallOtpActivation {
  const activation = asRecord(row);
  const actions = asRecord(activation.actions);
  return {
    activationId: pickString(activation, ["activationId", "activation_id", "id"]) ?? fallbackId,
    phoneNumber: pickString(activation, ["phoneNumber", "phone_number", "number", "msisdn"]),
    code: pickString(activation, ["code", "smsCode", "sms_code", "otp"]),
    price: nonNegative(pickNumber(activation, ["price", "amount", "cost"])),
    currency: currencyCode(pickString(activation, ["currency"])),
    status: normalizeOtpStatus(pickString(activation, ["status", "state"])),
    serviceId: pickString(activation, ["serviceId", "service_id"]),
    actions: {
      canResend: actions.canResend === true || actions.can_resend === true,
      canReactivate: actions.canReactivate === true || actions.can_reactivate === true,
    },
  };
}

/**
 * Rents a number and **charges for it**.
 *
 * Nothing here retries, and nothing may. Their instruction is explicit: *"Each
 * call to this endpoint rents a number and charges for it. If it times out or
 * fails without a clear answer, do not resend it — read your orders back to see
 * whether one was created, and only then decide whether to try again."*
 *
 * On rejection, call `isAmbiguousBitcallOutcome(error)`. If it is true the only
 * safe next step is `listBitcallOtpActivations()` to check whether one was
 * created — not a resend, and not a failover to another supplier, which would
 * risk renting twice and delivering two numbers for one customer order.
 */
export async function buyBitcallOtpActivation(serviceId: string): Promise<BitcallOtpActivation> {
  const id = serviceId.trim();
  // The shape is deliberately *not* validated beyond presence: their docs warn
  // that a serviceId you construct will not resolve, and a format check would
  // only make an invented id look sanctioned. It must come from the catalog.
  if (!id || id.length > 200) {
    throw new BitcallError("Invalid service id", 400, "VALIDATION_ERROR", null, ["serviceId"]);
  }
  const payload = await gatewayFetch("POST", "/v1/otp/activations", { body: { serviceId: id } });
  const envelope = asRecord(payload);
  return parseOtpActivation(envelope.data ?? envelope, null);
}

/**
 * Polls one activation. An id that is unknown — **or that is not yours** — answers
 * `404`, never an empty result; the two cases are indistinguishable by design.
 */
export async function getBitcallOtpActivation(activationId: string): Promise<BitcallOtpActivation> {
  const id = activationId.trim();
  if (!id || id.length > 200) {
    throw new BitcallError("Invalid activation id", 400, "VALIDATION_ERROR", null, ["activationId"]);
  }
  const payload = await gatewayFetch("GET", `/v1/otp/activations/${encodeURIComponent(id)}`);
  const envelope = asRecord(payload);
  return parseOtpActivation(envelope.data ?? envelope, id);
}

/**
 * Several activations, newest first, for a dashboard.
 *
 * This collection carries **no `activationId` filter** — a single rental is always
 * polled by path via `getBitcallOtpActivation`. It is also the reconciliation read
 * after an ambiguous purchase: the only way to learn whether a timed-out create
 * actually rented a number.
 *
 * Accepted `status` values are not published for this endpoint, so the filter is
 * passed through rather than checked locally. A wrong value answers
 * `400 VALIDATION_ERROR` naming `query.status`, which is a clearer failure than a
 * local guess would be — and unlike the eSIM order list, an empty result here does
 * not masquerade as "you have none".
 */
export async function listBitcallOtpActivations(
  filter: { status?: string; page?: number; pageSize?: number } = {},
): Promise<BitcallOtpActivation[]> {
  const payload = await gatewayFetch("GET", "/v1/otp/activations", {
    query: { status: filter.status, page: filter.page, pageSize: filter.pageSize },
  });
  const activations: BitcallOtpActivation[] = [];
  const seen = new Set<string>();
  for (const row of rowsFrom(payload).slice(0, 2000)) {
    const activation = parseOtpActivation(row, null);
    if (!activation.activationId || seen.has(activation.activationId)) continue;
    seen.add(activation.activationId);
    activations.push(activation);
  }
  return activations;
}

/**
 * Cancels an unused rental. **The refund is not a separate step:** an order reaches
 * `refunded` on its own, because cancelling before the code arrives returns the
 * rental. There is no refund endpoint to call.
 *
 * Can be refused with `409 CANCELLATION_NOT_AVAILABLE_YET` — a short provider
 * cooldown before a fresh number may be cancelled. It lifts on its own and nothing
 * was charged, so waiting and retrying is correct here in a way it is not for the
 * purchase above.
 */
export async function cancelBitcallOtpActivation(activationId: string): Promise<BitcallOtpActivation> {
  const id = activationId.trim();
  if (!id || id.length > 200) {
    throw new BitcallError("Invalid activation id", 400, "VALIDATION_ERROR", null, ["activationId"]);
  }
  const payload = await gatewayFetch("POST", `/v1/otp/activations/${encodeURIComponent(id)}/cancel`);
  const envelope = asRecord(payload);
  return parseOtpActivation(envelope.data ?? envelope, id);
}

/** Resends the code. Gated by a local, time-based cooldown reported as `canResend`. */
export async function resendBitcallOtpActivation(activationId: string): Promise<BitcallOtpActivation> {
  const id = activationId.trim();
  if (!id || id.length > 200) {
    throw new BitcallError("Invalid activation id", 400, "VALIDATION_ERROR", null, ["activationId"]);
  }
  const payload = await gatewayFetch("POST", `/v1/otp/activations/${encodeURIComponent(id)}/resend`);
  const envelope = asRecord(payload);
  return parseOtpActivation(envelope.data ?? envelope, id);
}

/**
 * Reactivates an expired rental. **Not charged when refused** — `409
 * REACTIVATION_UNAVAILABLE` means the window closed, whatever `canReactivate`
 * said, and the correct response is a new number rather than another attempt.
 */
export async function reactivateBitcallOtpActivation(activationId: string): Promise<BitcallOtpActivation> {
  const id = activationId.trim();
  if (!id || id.length > 200) {
    throw new BitcallError("Invalid activation id", 400, "VALIDATION_ERROR", null, ["activationId"]);
  }
  const payload = await gatewayFetch("POST", `/v1/otp/activations/${encodeURIComponent(id)}/reactivate`);
  const envelope = asRecord(payload);
  return parseOtpActivation(envelope.data ?? envelope, id);
}
