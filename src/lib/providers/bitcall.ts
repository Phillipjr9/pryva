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
 * eSIM plans use the documented nested money object and dataMb allowance. The
 * live account's response and settlement still need operational verification;
 * accepting legacy aliases is not evidence of what a particular account returns.
 */

import "server-only";
import { createRateLimiter } from "@/lib/platform/rate-limit";
import { readJsonWithLimit } from "@/lib/platform/request-body";
import { retryAfterDelayMs } from "@/lib/platform/retry-after";
import { logger } from "@/lib/platform/logger";
import { ProviderError } from "@/lib/providers/types";

const API_HOST = "api.bitcall.io";
const REQUEST_TIMEOUT_MS = 20_000;
// The separate eSIM browsing cap remains shared across app instances. It is
// charged once per catalogue walk rather than once per page. The gateway's own
// 429 responses are still surfaced; there is no app-wide per-key request budget.
const esimCatalogBudget = createRateLimiter({ windowMs: 60_000, maxRequests: 12 });

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

export class BitcallError extends ProviderError {
  /** Equal to the `x-request-id` header. Quote it to their support. */
  readonly requestId: string | null;
  /** Offending field paths on VALIDATION_ERROR. Never carries their values. */
  readonly fields: string[];
  readonly retryAfterSeconds: number | null;

  constructor(
    message: string,
    status: number,
    /** The gateway's own code where it supplied one; otherwise a local one. */
    code: string,
    requestId: string | null = null,
    fields: string[] = [],
    retryAfterSeconds: number | null = null,
  ) {
    super(message, { provider: "bitcall", status, code });
    this.name = "BitcallError";
    this.requestId = requestId;
    this.fields = fields;
    this.retryAfterSeconds = retryAfterSeconds;
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

/** Both halves are required, and production must never fulfill using a test key. */
export function isBitcallConfigured(): boolean {
  const id = bitcallKeyId();
  if (!id || !bitcallApiSecret()) return false;
  return !productionGateway() || (id.startsWith("ak_live_") && id.length > "ak_live_".length);
}

function productionGateway(): boolean {
  return process.env.VERCEL_ENV === "production" || (!process.env.VERCEL_ENV && process.env.NODE_ENV === "production");
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

/** Only an actual boolean is evidence of a capability; missing or malformed is unknown. */
function booleanOrNull(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
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
  options: {
    query?: Record<string, string | number | undefined>;
    body?: Record<string, unknown>;
    /** Optional deadline for a read-only catalogue walk. */
    signal?: AbortSignal;
    /** This call reads the catalogue on a customer's behalf. */
    catalogRead?: boolean;
    /**
     * Charge the catalogue cap or not, overriding the path default. A paginated
     * walk charges it once, on its first page (see esimCatalogBudget).
     */
    catalogCharge?: boolean;
  } = {},
): Promise<unknown> {
  const keyId = bitcallKeyId();
  const secret = bitcallApiSecret();
  if (!keyId) throw new BitcallError("BITCALL_KEY_ID is not configured", 503, "NO_KEY_ID");
  if (!secret) throw new BitcallError("BITCALL_API_SECRET is not configured", 503, "NO_API_SECRET");
  if (productionGateway() && (!keyId.startsWith("ak_live_") || keyId.length <= "ak_live_".length)) {
    throw new BitcallError("A live gateway key is required in production", 503, "INVALID_KEY_ENVIRONMENT");
  }
  // Fail on a malformed secret here rather than as an opaque 401 later: the
  // gateway answers INVALID_API_KEY identically for a wrong secret, a revoked
  // key, an unknown key and a disallowed IP, so it cannot tell you which.
  if (!/^[0-9a-f]{128}$/i.test(secret)) {
    throw new BitcallError("BITCALL_API_SECRET is not a 128-character hex string", 503, "MALFORMED_SECRET");
  }
  const base = gatewayBase();

  const chargesCatalogCap = options.catalogCharge ??
    (Boolean(options.catalogRead) || path === "/v1/esim/plans" || path === "/v1/esim/countries");
  if (method === "GET" && chargesCatalogCap) {
    const catalogBudget = await esimCatalogBudget("bitcall:esim-catalog-budget");
    if (catalogBudget.unavailable) throw new BitcallError("Gateway rate limit is unavailable", 503, "RATE_LIMIT_UNAVAILABLE");
    if (!catalogBudget.allowed) throw new BitcallError("eSIM catalog rate budget reached", 429, "LOCAL_RATE_BUDGET");
  }
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
      signal: options.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
        : AbortSignal.timeout(REQUEST_TIMEOUT_MS),
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
  const retryAfterMs = retryAfterDelayMs(response.headers.get("Retry-After"));
  const parsedRetryAfter = retryAfterMs === null ? null : Math.ceil(retryAfterMs / 1000);
  const retryAfter = parsedRetryAfter !== null && Number.isSafeInteger(parsedRetryAfter) && parsedRetryAfter >= 0 ? parsedRetryAfter : null;

  let payload: unknown = null;
  if (response.status !== 204) {
    try {
      payload = await readJsonWithLimit(response, 4_194_304);
    } catch {
      await response.body?.cancel().catch(() => {});
      // A proxy can throttle with an HTML body; the status and cooldown still
      // forbid retrying early even though there is no usable error envelope.
      if (response.status === 429) throw new BitcallError("Gateway rate limited", 429, "RATE_LIMITED", requestId, [], retryAfter);
      throw new BitcallError("Invalid gateway response", 502, "SERVICE_RESPONSE_INVALID", requestId);
    }
  }

  const envelope = asRecord(payload);
  const errorBody = asRecord(envelope.error);
  const upstreamCode = pickString(errorBody, ["code"]);

  // Their error envelope can accompany a non-2xx status. Trust the code.
  if (!response.ok || upstreamCode) {
    const code = response.status === 429 ? "RATE_LIMITED" : upstreamCode ?? "SERVICE_RESPONSE_INVALID";
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
      retryAfter,
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
  unlimitedData: boolean | null;
  /** Validity period, as the catalog reports it. Units are not assumed. */
  validity: number | null;
  validityUnit: string | null;
  /**
   * The account's price in its settlement currency. The gateway's money
   * conventions say these prices are what the account pays, not its provider's
   * internal cost. Conversion and retail pricing happen outside the client.
   */
  price: number | null;
  currency: string | null;
  /** Supplier-reported plan features; null means the catalog did not specify them. */
  includesPhoneNumber: boolean | null;
  supportsVoice: boolean | null;
  supportsSms: boolean | null;
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
    const entries = stringList(value);
    if (entries.length > 0) return entries;
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

/** Maximum 1,000 rows per read; additional pages are reported as incomplete. */
export const ESIM_PLAN_PAGE_SIZE = 200;
export const ESIM_PLAN_MAX_PAGES = 5;

/**
 * Why a plan read is not the whole catalogue.
 *
 * `budget` is the one we inflict on ourselves: a local cap refused a later page.
 * That is not evidence the supplier publishes fewer plans, so a caller must not
 * render it as a smaller catalogue. Everything else is either the supplier's own
 * shape (`upstream`, `unpaged`) or our deliberate bound (`page-cap`).
 */
export type BitcallEsimPlansPartial = "budget" | "upstream" | "unpaged" | "page-cap" | "no-progress";

export type BitcallEsimPlans = {
  plans: BitcallEsimPlan[];
  /** A page failed, metadata was missing, or more pages remain beyond our cap. */
  partial: boolean;
  /** Which of those it was; null when the read is whole. */
  partialReason: BitcallEsimPlansPartial | null;
  /** Raw rows encountered, including invalid or duplicate references. */
  returned: number;
  unreadable: number;
};

/** The same parser is used for list rows and the purchase-time single-plan read. */
function parseEsimPlan(row: UnknownRecord): BitcallEsimPlan | null {
  const planId = pickString(row, ["planId", "plan_id", "id"]);
  if (!planId || !/^pln_[A-Za-z0-9_-]{1,128}$/.test(planId)) return null;

  const capabilities = asRecord(row.capabilities);
  const dataMb = nonNegative(pickNumber(row, ["dataMb"]));
  // Only convert exact 1024 MB multiples. Otherwise report the original MB
  // amount rather than rounding the allowance into something the plan lacks.
  const wholeGb = dataMb !== null && dataMb >= 1024 && dataMb % 1024 === 0;
  const days = nonNegative(pickNumber(row, ["validityDays"]));
  const money = asRecord(row.price);
  const hasMoneyObject = row.price !== null && typeof row.price === "object" && !Array.isArray(row.price);
  // If an explicit legacy price is malformed, don't substitute a different
  // top-level amount whose meaning may not match that price's currency.
  const legacyAmount = row.price !== null && row.price !== undefined
    ? pickNumber(row, ["price"])
    : pickNumber(row, ["amount", "retailPrice", "sellingPrice"]);
  return {
    planId,
    name: pickString(row, ["name", "title", "planName"]),
    region: pickString(row, ["region", "regionName"]),
    countries: coverageList(row),
    allowance: dataMb !== null ? (wholeGb ? dataMb / 1024 : dataMb) : nonNegative(pickNumber(row, ["allowance", "data", "dataAllowance", "allowanceValue"])),
    allowanceUnit: dataMb !== null ? (wholeGb ? "GB" : "MB") : pickString(row, ["allowanceUnit", "dataUnit", "unit"]),
    unlimitedData: booleanOrNull(row.unlimitedData),
    validity: days ?? nonNegative(pickNumber(row, ["validity", "days", "duration"])),
    validityUnit: days !== null ? "days" : pickString(row, ["validityUnit", "durationUnit"]),
    // Treat amount and currency as an inseparable pair. In particular, never
    // attach a top-level currency to an incomplete nested price object.
    price: nonNegative(hasMoneyObject ? pickNumber(money, ["amount"]) : legacyAmount),
    currency: currencyCode(hasMoneyObject ? pickString(money, ["currency"]) : legacyAmount === null ? null : pickString(row, ["currency"])),
    includesPhoneNumber: booleanOrNull(row.includesPhoneNumber),
    supportsVoice: booleanOrNull(capabilities.voice),
    supportsSms: booleanOrNull(capabilities.sms),
  };
}

/**
 * Bounded pagination. The default gateway page is only 50 rows. Fetch larger
 * pages, stop at a conservative cap, and explicitly report incomplete reads.
 * A later-page failure never discards rows already read; a first-page failure
 * still fails the catalog. Nothing here retries a money-spending request.
 */
export async function listBitcallEsimPlans(filter: { region?: string } = {}): Promise<BitcallEsimPlans> {
  const plans: BitcallEsimPlan[] = [];
  const seen = new Set<string>();
  let returned = 0;
  let unreadable = 0;
  let partialReason: BitcallEsimPlansPartial | null = null;
  let sampleKeys: string[] | null = null;

  // The pages after the first are requested together (see readCataloguePages)
  // and then consumed in page order, so a refusal still stops the walk where it
  // stopped when the requests were serial — earlier pages are kept, later ones
  // are not presented as a whole catalogue.
  const pages = await readCataloguePages("/v1/esim/plans", {
    pageSize: ESIM_PLAN_PAGE_SIZE,
    maxPages: ESIM_PLAN_MAX_PAGES,
    query: { region: filter.region, sort: "price_asc" },
    // One token for the whole walk; see the note on esimCatalogBudget.
    catalogCharge: (page) => page === 1,
  });

  for (const entry of pages) {
    const page = entry.page;
    if (entry.error !== null) {
      if (page === 1) throw entry.error;
      const code = entry.error instanceof BitcallError ? entry.error.code : "UNKNOWN";
      // A refusal by our own cap is not the supplier withholding plans.
      partialReason = code === "LOCAL_RATE_BUDGET" ? "budget" : "upstream";
      logger.warn("eSIM catalog pagination incomplete", { page, code, reason: partialReason });
      break;
    }

    const payload = entry.payload;
    const envelope = asRecord(payload);
    const hasRows = Array.isArray(payload) || ["data", "items", "plans"].some((key) => Array.isArray(envelope[key]));
    if (!hasRows) {
      if (page === 1) throw new BitcallError("Invalid eSIM catalog response", 502, "SERVICE_RESPONSE_INVALID");
      partialReason = "upstream";
      break;
    }
    const rows = rowsFrom(payload);
    returned += rows.length;
    let added = 0;
    for (const row of rows.slice(0, ESIM_PLAN_PAGE_SIZE)) {
      const plan = parseEsimPlan(row);
      if (!plan || !plan.planId) {
        unreadable += 1;
        if (!sampleKeys) sampleKeys = Object.keys(row).slice(0, 12);
        continue;
      }
      if (seen.has(plan.planId)) continue;
      seen.add(plan.planId);
      plans.push(plan);
      added += 1;
    }
    // A response exceeding the requested page size is not a complete read.
    if (rows.length > ESIM_PLAN_PAGE_SIZE) { partialReason = "unpaged"; break; }
    const meta = asRecord(envelope.meta);
    if (typeof meta.page === "number" && meta.page !== page) { partialReason = "unpaged"; break; }
    if (typeof meta.hasNext !== "boolean") { partialReason = "unpaged"; break; }
    if (!meta.hasNext) break;
    // Stop repeated/empty pages and mark the cap instead of looping indefinitely.
    if (added === 0) { partialReason = "no-progress"; break; }
    if (page === ESIM_PLAN_MAX_PAGES) { partialReason = "page-cap"; break; }
  }

  if (returned > 0 && plans.length === 0) {
    logger.error("eSIM catalog returned rows but none were readable", { rows: returned, sampleKeys });
  } else if (unreadable > 0) {
    logger.warn("eSIM catalog rows skipped", { rows: returned, skipped: unreadable, sampleKeys });
  }
  return { plans, partial: partialReason !== null, partialReason, returned, unreadable };
}

/** Re-read the specific plan just before a purchase; the catalog itself is cached. */
export async function getBitcallEsimPlan(planId: string, options: { browse?: boolean } = {}): Promise<BitcallEsimPlan | null> {
  const id = planId.trim();
  if (!/^pln_[A-Za-z0-9_-]{1,128}$/.test(id)) {
    throw new BitcallError("Invalid plan reference", 400, "VALIDATION_ERROR", null, ["planId"]);
  }
  const payload = await gatewayFetch("GET", `/v1/esim/plans/${encodeURIComponent(id)}`, { catalogRead: options.browse });
  const envelope = asRecord(payload);
  const plan = parseEsimPlan(asRecord(envelope.data ?? envelope));
  return plan?.planId === id ? plan : null;
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
  if (!/^pln_[A-Za-z0-9_-]{1,128}$/.test(id)) {
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
   * Opaque. "Read it, do not build it — the segments are spelled the way the
   * selling side spells them, and a value you build will not resolve." It is
   * documented as pool-country-service, which is why the country catalogue can
   * be joined to it, and why its trailing segment can label an offer whose
   * service the catalogue did not name (see `otpServiceLabelFromId`). It is
   * never generated or validated against: only read, and never sent to a
   * customer.
   */
  serviceId: string | null;
  /** The price this offer charges. Units and cost-vs-retail are not assumed here. */
  price: number | null;
  currency: string | null;
  /** Present only when the offer itself explicitly names a destination. */
  countryCode?: string;
  /** Multiple explicit country fields must all agree with the selected destination. */
  declaredCountries?: string[];
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
  declaredCountries?: string[];
  offers: BitcallOtpOffer[];
};

/**
 * An offer's money, in both shapes the gateway uses.
 *
 * A pool carries the documented `{ amount, currency }` object; a bare number is
 * the older shape. Reading `price` with `pickNumber` alone returned null for the
 * amount *and* the currency of every documented offer, so a full catalogue
 * priced as "unknown" — and an unknown cost can be neither sold nor ranked.
 */
function parseOtpMoney(row: Record<string, unknown>): { amount: number | null; currency: string | null } {
  const nested = asRecord(row.price);
  const hasMoneyObject = row.price !== null && typeof row.price === "object" && !Array.isArray(row.price);
  const legacyAmount = row.price !== null && row.price !== undefined
    ? pickNumber(row, ["price"])
    : pickNumber(row, ["amount", "cost"]);
  return {
    amount: nonNegative(hasMoneyObject ? pickNumber(nested, ["amount", "value"]) : legacyAmount),
    // A currency outside a nested price is not evidence for an incomplete price.
    currency: currencyCode(hasMoneyObject ? pickString(nested, ["currency"]) : legacyAmount === null ? null : pickString(row, ["currency"])),
  };
}

/** Only explicit fields are country evidence; a serviceId or slug is opaque. */
function otpDeclaredCountries(row: UnknownRecord): string[] {
  const nested = asRecord(row.country);
  const values = [
    pickString(row, ["country_code"]), pickString(row, ["countryCode"]), pickString(row, ["country"]),
    pickString(nested, ["countryCode"]), pickString(nested, ["country_code"]), pickString(nested, ["code"]),
    pickString(nested, ["name", "countryName"]),
  ].filter((value): value is string => value !== null);
  return [...new Set(values.map((value) => value.trim()))];
}

function parseOtpOffer(row: unknown): BitcallOtpOffer | null {
  const offer = asRecord(row);
  // Without a serviceId the offer cannot be bought, so it cannot be offered.
  const serviceId = pickString(offer, ["serviceId", "service_id", "id"]);
  if (!serviceId) return null;
  const money = parseOtpMoney(offer);
  const countries = otpDeclaredCountries(offer);
  return {
    serviceId,
    price: money.amount,
    currency: money.currency,
    ...(countries.length ? { countryCode: countries[0] } : {}),
    ...(countries.length > 1 ? { declaredCountries: countries } : {}),
    availableCount: nonNegative(pickNumber(offer, ["availableCount", "available_count", "available", "stock", "count"])),
    successRate: nonNegative(pickNumber(offer, ["successRate", "success_rate", "success"])),
  };
}

function parseOtpService(row: unknown): BitcallOtpService {
  const service = asRecord(row);
  const pools = Array.isArray(service.pools) ? service.pools : [];
  const offers: BitcallOtpOffer[] = [];
  for (const entry of pools) {
    const offer = parseOtpOffer(entry);
    if (offer) offers.push(offer);
  }
  const countries = otpDeclaredCountries(service);
  return {
    name: pickString(service, ["name", "title", "serviceName"]),
    slug: pickString(service, ["slug", "serviceSlug"]),
    countryCode: countries[0] ?? null,
    ...(countries.length > 1 ? { declaredCountries: countries } : {}),
    offers,
  };
}

/** The documented page size; the catalogue runs to thousands of services. */
const OTP_PAGE_SIZE = 200;


/** `meta.hasNext` when stated; otherwise compare page with totalPages. */
function hasNextPage(payload: unknown): boolean {
  const meta = asRecord(asRecord(payload).meta);
  if (typeof meta.hasNext === "boolean") return meta.hasNext;
  const page = pickNumber(meta, ["page"]);
  const totalPages = pickNumber(meta, ["totalPages"]);
  return page !== null && totalPages !== null && page < totalPages;
}

/**
 * One page of a walk: the payload, or the error that stopped it.
 *
 * Errors are values here because the pages after the first are requested
 * together. One refusal must not cancel pages that are already in flight, and
 * only the caller knows what a failure on page one (fatal) rather than page
 * three (a partial read) means for its own catalogue.
 */
type CataloguePage =
  | { page: number; payload: unknown; error: null }
  | { page: number; payload: null; error: unknown };

function pageNumbers(from: number, to: number): number[] {
  return Array.from({ length: Math.max(0, to - from + 1) }, (_, index) => from + index);
}

/**
 * Every page a bounded walk needs, with the pages after the first in flight
 * together.
 *
 * These walks used to be strictly serial: page n+1 was requested only after page
 * n answered. A single destination read touches up to five pages of the country
 * catalogue and five of the service catalogue, and the eSIM walk runs alongside
 * both — so first paint cost the *sum* of a dozen round trips to a gateway on
 * another continent, for feeds that do not depend on each other.
 *
 * Page one stays alone because it is what states whether there is a second page
 * (`meta.hasNext`); when it also states how many (`meta.totalPages`) the rest go
 * out at once. Without a page count, page two is read next and then the
 * remainder, so a catalogue too short to have five pages is never billed for
 * them. `maxPages` still bounds the walk, and page one is the caller's to
 * interpret.
 */
async function readCataloguePages(
  path: string,
  options: {
    pageSize: number;
    maxPages: number;
    query?: Record<string, string | number | undefined>;
    /** Rate accounting per page; a walk charges its own token on page one. */
    catalogCharge?: (page: number) => boolean;
  },
): Promise<CataloguePage[]> {
  const fetchPage = async (page: number): Promise<CataloguePage> => {
    try {
      const payload = await gatewayFetch("GET", path, {
        query: { ...options.query, page, pageSize: options.pageSize },
        ...(options.catalogCharge ? { catalogCharge: options.catalogCharge(page) } : {}),
      });
      return { page, payload, error: null };
    } catch (error) {
      return { page, payload: null, error };
    }
  };

  const first = await fetchPage(1);
  const pages: CataloguePage[] = [first];
  if (first.error !== null || !hasNextPage(first.payload)) return pages;

  const totalPages = pickNumber(asRecord(asRecord(first.payload).meta), ["totalPages", "total_pages"]);
  if (totalPages !== null && totalPages > 1) {
    const last = Math.min(Math.floor(totalPages), options.maxPages);
    pages.push(...await Promise.all(pageNumbers(2, last).map(fetchPage)));
    return pages;
  }

  // No page count: one more page says whether the walk even continues, and the
  // rest still go out together rather than one at a time.
  const second = await fetchPage(2);
  pages.push(second);
  if (second.error !== null || !hasNextPage(second.payload)) return pages;
  pages.push(...await Promise.all(pageNumbers(3, options.maxPages).map(fetchPage)));
  return pages;
}

/** Walk every OTP catalogue page, without silently treating a bounded prefix as
 * the full feed. Batches bound concurrent read requests, not catalogue size. An
 * upstream failure or a pagination loop fails the read rather than caching an
 * incomplete list. Paid operations never use this read-only pagination helper. */
const OTP_MAX_PAGES = 50;
const OTP_SERVICE_KEYS = ["data", "items", "services"];
const OTP_COUNTRY_KEYS = ["data", "items", "countries"];

function otpRows(payload: unknown, keys: string[] = OTP_SERVICE_KEYS): UnknownRecord[] {
  const record = asRecord(payload);
  if (!Array.isArray(payload) && !keys.some((key) => Array.isArray(record[key]))) {
    throw new BitcallError("Invalid OTP catalogue response", 502, "SERVICE_RESPONSE_INVALID");
  }
  return rowsFrom(payload, keys);
}

async function readAllOtpPages(
  path: string,
  pageSize: number,
  query?: Record<string, string | number | undefined>,
  signal?: AbortSignal,
): Promise<CataloguePage[]> {
  // On the first failed page, abort sibling reads immediately. In particular a
  // 429 must not be hidden behind another page that stalls until the deadline.
  const controller = new AbortController();
  const walkSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  let firstFailure: unknown;
  const fetchPage = async (page: number): Promise<CataloguePage> => {
    try {
      return { page, payload: await gatewayFetch("GET", path, { query: { ...query, page, pageSize }, signal: walkSignal }), error: null };
    } catch (error) {
      if (firstFailure === undefined) {
        firstFailure = error;
        controller.abort();
      }
      throw firstFailure;
    }
  };
  const pages: CataloguePage[] = [];
  const fingerprints = new Set<string>();
  let next = 1;
  let last: number | null = null;
  while (true) {
    if (walkSignal.aborted || next > OTP_MAX_PAGES) {
      throw new BitcallError("OTP catalogue walk exceeded its budget", 502, "CATALOGUE_INCOMPLETE");
    }
    // Small batches avoid multiplying provider-account traffic when several
    // destination catalogues are read at the same time.
    const end = last === null ? next : Math.min(next + 1, last, OTP_MAX_PAGES);
    const batch = await Promise.all(pageNumbers(next, end).map(fetchPage));
    for (const entry of batch) {
      if (entry.error !== null) throw entry.error;
      const envelope = asRecord(entry.payload);
      const meta = asRecord(envelope.meta);
      const declaredPage = pickNumber(meta, ["page"]);
      const total = pickNumber(meta, ["totalPages", "total_pages"]);
      if (declaredPage !== null && declaredPage !== entry.page) {
        throw new BitcallError("OTP catalogue pagination did not advance", 502, "CATALOGUE_INCOMPLETE");
      }
      if (total !== null && (!Number.isSafeInteger(total) || total < 0 || total > OTP_MAX_PAGES ||
        (total < entry.page && !(entry.page === 1 && total === 0)) ||
        (last !== null && last !== total))) {
        throw new BitcallError("OTP catalogue pagination metadata conflicts", 502, "CATALOGUE_INCOMPLETE");
      }
      const rows = otpRows(entry.payload, path === "/v1/otp/countries" ? OTP_COUNTRY_KEYS : OTP_SERVICE_KEYS);
      const declaredCount = pickNumber(meta, ["total"]);
      if ((total === 0 && (rows.length > 0 || meta.hasNext === true)) ||
          (declaredCount !== null && (!Number.isSafeInteger(declaredCount) || declaredCount < 0 ||
            (declaredCount === 0 && rows.length > 0) || (declaredCount > 0 && rows.length === 0) || rows.length > declaredCount))) {
        // A positive reported total with an empty page is not evidence of no
        // inventory. Likewise, rows cannot belong to a zero-sized catalogue.
        throw new BitcallError("OTP catalogue pagination metadata conflicts", 502, "CATALOGUE_INCOMPLETE");
      }
      const fingerprint = JSON.stringify(rows);
      if (entry.page > 1 && fingerprints.has(fingerprint)) {
        throw new BitcallError("OTP catalogue pagination repeated a page", 502, "CATALOGUE_INCOMPLETE");
      }
      fingerprints.add(fingerprint);
      pages.push(entry);
      if (total !== null && total >= entry.page) last = total;
      if (typeof meta.hasNext === "boolean") {
        if (!meta.hasNext) {
          if (last !== null && entry.page < last) throw new BitcallError("OTP catalogue pagination metadata conflicts", 502, "CATALOGUE_INCOMPLETE");
          return pages;
        }
        if (last !== null && entry.page >= last) throw new BitcallError("OTP catalogue pagination metadata conflicts", 502, "CATALOGUE_INCOMPLETE");
        if (rows.length === 0) throw new BitcallError("OTP catalogue pagination made no progress", 502, "CATALOGUE_INCOMPLETE");
      } else if (last === null) {
        // Short, unpaged responses are accepted; a full page without metadata
        // cannot prove that there is no next page.
        if (rows.length < pageSize) return pages;
        throw new BitcallError("OTP catalogue completeness could not be confirmed", 502, "CATALOGUE_INCOMPLETE");
      }
      if (last !== null && entry.page >= last) return pages;
    }
    next = end + 1;
  }
}

/**
 * The service catalogue is global unless the documented `country_code` filter
 * is sent. Filter with a value published by /v1/otp/countries, never a guessed
 * service ID. A filtered row may omit a country; preserve that absence so callers
 * can detect conflicting explicit country fields rather than masking them.
 */
export async function listBitcallOtpServices(
  filter: { q?: string; pageSize?: number; countryCode?: string } = {},
  options: { signal?: AbortSignal } = {},
): Promise<BitcallOtpService[]> {
  const pages = await readAllOtpPages("/v1/otp/services", filter.pageSize ?? OTP_PAGE_SIZE, {
    q: filter.q, country_code: filter.countryCode,
  }, options.signal);
  const services: BitcallOtpService[] = [];
  for (const entry of pages) {
    if (entry.error !== null) throw entry.error;
    for (const row of otpRows(entry.payload)) {
      const service = parseOtpService(row);
      // An explicit empty pools array is valid. Missing pools or unreadable
      // offers cannot be discarded while claiming the catalogue is complete:
      // even one valid empty row alongside a malformed one used to look like 0.
      if (!Array.isArray(row.pools) || service.offers.length !== row.pools.length) {
        throw new BitcallError("Unreadable OTP services", 502, "SERVICE_RESPONSE_INVALID");
      }
      if (service.offers.length > 0) services.push(service);
    }
  }
  return services;
}

/**
 * Resolve one exact provider-published offer. Unlike the list, this documented
 * response is flat and includes an explicit country on each offer. Used just
 * before spending so even an upstream filter regression cannot buy a number in
 * a different country. A name-search result or incomplete response is not a
 * confirmation of the chosen ID.
 */
export async function getBitcallOtpOffer(serviceId: string): Promise<(Omit<BitcallOtpOffer, "countryCode"> & { countryCode: string | null }) | null> {
  if (!serviceId.trim() || serviceId.length > 200) {
    throw new BitcallError("Invalid service reference", 400, "VALIDATION_ERROR");
  }
  const payload = await gatewayFetch("GET", `/v1/otp/services/${encodeURIComponent(serviceId)}`, {
    signal: AbortSignal.timeout(6_000),
  });
  const rows = otpRows(payload);
  const meta = asRecord(asRecord(payload).meta);
  const page = pickNumber(meta, ["page"]);
  const totalPages = pickNumber(meta, ["totalPages", "total_pages"]);
  const total = pickNumber(meta, ["total"]);
  if (rows.length !== 1 || pickString(rows[0], ["serviceId", "service_id"]) !== serviceId ||
      meta.hasNext === true || (page !== null && page !== 1) ||
      (totalPages !== null && totalPages !== 1) || (total !== null && total !== 1)) return null;
  const offer = parseOtpOffer(rows[0]);
  if (!offer) return null;
  return { ...offer, countryCode: offer.countryCode ?? null };
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
  return rowsFrom(payload).slice(0, 2000).map((row) => parseOtpService(row)).filter((service) => service.offers.length > 0);
}

/**
 * One destination published by the country catalogue. The documented response
 * provides country codes and starting prices, not individual service offers.
 * The optional pools field is retained for compatibility with older responses;
 * use the country-filtered service catalogue for current app-specific offers.
 */
export type BitcallOtpCountryEntry = {
  /** The provider's own identifier, e.g. `US_1`. Sent back, never built. */
  countryCode: string | null;
  /** The provider's own label, e.g. "United States (Virtual)". */
  name: string | null;
  serviceCount: number | null;
  availableCount: number | null;
  startingPrice: number | null;
  currency: string | null;
  pools: BitcallOtpOffer[];
};

function parseOtpCountryEntry(row: unknown): BitcallOtpCountryEntry {
  const country = asRecord(row);
  const starting = asRecord(country.startingPrice);
  const pools: BitcallOtpOffer[] = [];
  const seen = new Set<string>();
  for (const entry of Array.isArray(country.pools) ? country.pools : []) {
    const offer = parseOtpOffer(entry);
    if (!offer?.serviceId || seen.has(offer.serviceId)) continue;
    seen.add(offer.serviceId);
    pools.push(offer);
  }
  return {
    countryCode: pickString(country, ["countryCode", "country_code", "code", "country"]),
    name: pickString(country, ["name", "countryName", "title"]),
    serviceCount: nonNegative(pickNumber(country, ["serviceCount", "service_count"])),
    availableCount: nonNegative(pickNumber(country, ["availableCount", "available_count"])),
    startingPrice: nonNegative(pickNumber(starting, ["amount"])) ?? nonNegative(pickNumber(country, ["startingPrice"])),
    currency: currencyCode(pickString(starting, ["currency"])) ?? currencyCode(pickString(country, ["currency"])),
    pools,
  };
}

/** Every destination the catalogue publishes, with optional legacy pools. */
export async function listBitcallOtpCountryEntries(options: { signal?: AbortSignal } = {}): Promise<BitcallOtpCountryEntry[]> {
  const pages = await readAllOtpPages("/v1/otp/countries", OTP_PAGE_SIZE, undefined, options.signal);
  const entries: BitcallOtpCountryEntry[] = [];
  for (const entry of pages) {
    if (entry.error !== null) throw entry.error;
    const rows = otpRows(entry.payload, OTP_COUNTRY_KEYS).map(parseOtpCountryEntry);
    if (rows.some((row) => !row.countryCode || row.countryCode.trim().length > 100)) {
      throw new BitcallError("Unreadable OTP country", 502, "SERVICE_RESPONSE_INVALID");
    }
    entries.push(...rows);
  }
  return entries;
}

export async function listBitcallOtpCountries(): Promise<string[]> {
  const codes = new Set<string>();
  for (const entry of await listBitcallOtpCountryEntries()) {
    const code = entry.countryCode?.trim();
    if (code) codes.add(code.toUpperCase());
  }
  return [...codes];
}

/**
 * The destination segment of a published service id, e.g. `US_1` from
 * `BRAVO-US_1-gmx`.
 *
 * The id is opaque per the docs — "send it back as published" — but it is built
 * as `provider-country-service`, and the country catalogue publishes exactly one
 * such shape. Reading the segment is therefore only ever used to *attribute* an
 * offer when the catalogue did not state the destination itself, and never to
 * rewrite or rebuild an id: whatever is sent back to the gateway is the value it
 * published.
 */
export function otpCountrySegmentFromId(serviceId: string): string | null {
  const segments = serviceId.split("-").filter((segment) => segment.length > 0);
  if (segments.length < 3) return null;
  return segments[1] ?? null;
}

/**
 * A display label for a pooled offer.
 *
 * `serviceId` is opaque: it is never built, validated or compared by parts, and
 * the raw value never leaves the server. The gateway does document its shape as
 * pool-country-service, though, and a country's pools name no service at all —
 * so the trailing segment is the one thing that can label the app behind an
 * offer. It is read for display only, and only after the service catalogue
 * failed to name that offer.
 */
export function otpServiceLabelFromId(serviceId: string): string | null {
  const segments = serviceId.split("-");
  if (segments.length < 3) return null;
  const label = segments
    .slice(2)
    .join("-")
    .replace(/_\/_/g, " / ")
    .replace(/[_+]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return label ? label.slice(0, 40) : null;
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
