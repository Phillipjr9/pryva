/**
 * Fleexa developer API client (historical endpoint shapes are unverified).
 *
 * Overview: https://fleexa.com.ng/docs. Existing attempted routes include
 *   • SMS OTP     — GET /sms4/apps, GET /sms4/prices, POST /sms4/buy,
 *                   GET /sms4/check/:requestId, POST /sms4/cancel
 *   • Email OTP   — GET /email/products, POST /email/buy,
 *                   GET /email/check/:emailId, POST /email/cancel
 *   • Rentals     — GET /rent/sms4/areas, POST /rent/sms4/buy,
 *                   GET /rent/sms4/numbers, GET /rent/sms4/sms
 *   • Account     — GET /profile, GET /balance
 *   • Proxies     — GET /proxy/products, POST /proxy/buy, GET /proxy/check/:id,
 *                   POST /proxy/cancel  (NOT PUBLISHED — see PROXIES.md)
 *
 * Published API surface, checked 2 Nov 2026 against /api and /llms.txt: numbers
 * (`/sms4`, `/sms5`, `/sms6`), email (`/email`), rentals (`/rent`), eSIM
 * (`/esim`), account (`/profile`, `/balance`). Proxies are sold in the supplier's
 * dashboard but appear in none of those lists, so the `/proxy/*` block below is a
 * probe, not an integration. Do not build a checkout on it until a supplier
 * response — not a smoke test that would 404 — proves the family exists.
 *
 * Auth: `Authorization: Bearer flx_live_...` or X-API-Key.
 * Envelope: `{ success, message, error_code, details, http_code }`.
 * Prices: NGN, already reseller-discounted for API keys (`price_ngn` / `rate`).
 * Rate limit: 60 requests / minute / key (HTTP 429).
 * Poll OTP endpoints every 20–30 seconds.
 */

import "server-only";
import { createRateLimiter } from "@/lib/rate-limit";
import { readJsonWithLimit } from "@/lib/request-body";

const DEFAULT_BASE_URL = "https://fleexa.com.ng/developer";
const REQUEST_TIMEOUT_MS = 20_000;
// Fleexa documents 60 requests/minute/key. The 25-per-window shared budget
// leaves boundary headroom, but cannot account for manual calls or network delay.
const supplierBudget = createRateLimiter({ windowMs: 60_000, maxRequests: 25 });

export class FleexaError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "FleexaError";
  }
}

export function fleexaApiKey(): string | null {
  const key = process.env.FLEEXA_API_KEY?.trim();
  return key ? key : null;
}

export function isFleexaConfigured(): boolean {
  return fleexaApiKey() !== null;
}

function baseUrl(): string {
  const value = (process.env.FLEEXA_BASE_URL?.trim() || process.env.FLEEXA_API_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, "");
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "fleexa.com.ng" || url.port || url.username || url.password ||
        url.pathname !== "/developer" || url.search || url.hash) throw new Error("Invalid URL");
    return url.origin + url.pathname;
  } catch {
    throw new FleexaError("Invalid provider configuration", 503, "INVALID_BASE_URL");
  }
}

type Envelope = {
  success?: boolean;
  message?: string;
  error_code?: string;
  details?: unknown;
  http_code?: number;
  [key: string]: unknown;
};

async function fleexaFetch(
  path: string,
  init: { method?: "GET" | "POST"; body?: Record<string, unknown> } = {},
): Promise<Record<string, unknown>> {
  // Purchase and cancellation are enabled. The request/response field names
  // are still parsed defensively (see the pickString alias lists) because the
  // written contract has not been confirmed against a live key: smoke-test a
  // single cheap purchase before taking customer money.
  const key = fleexaApiKey();
  if (!key) throw new FleexaError("FLEEXA_API_KEY is not configured", 503, "NO_API_KEY");
  const base = baseUrl();
  const budget = await supplierBudget("fleexa:shared-key-budget");
  if (budget.unavailable) throw new FleexaError("Provider rate limit is unavailable", 503, "RATE_LIMIT_UNAVAILABLE");
  if (!budget.allowed) throw new FleexaError("Provider rate limit reached", 429, "RATE_LIMITED");

  let response: Response;
  try {
    response = await fetch(`${base}${path}`, {
      method: init.method ?? "GET",
      redirect: "error",
      headers: {
        Authorization: `Bearer ${key}`,
        "X-API-Key": key,
        Accept: "application/json",
        ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (error) {
    const isTimeout = error instanceof Error && error.name === "TimeoutError";
    throw new FleexaError(
      isTimeout ? "Fleexa took too long to respond" : "Could not reach Fleexa",
      502,
      "UPSTREAM_UNREACHABLE",
    );
  }

  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new FleexaError("Provider request failed", response.status === 429 ? 429 : 502, response.status === 429 ? "RATE_LIMITED" : "UPSTREAM_ERROR");
  }
  let payload: unknown;
  try {
    payload = await readJsonWithLimit(response, 1_048_576);
  } catch {
    throw new FleexaError("Invalid provider response", 502, "INVALID_RESPONSE");
  }
  if (!payload || typeof payload !== "object") throw new FleexaError("Invalid provider response", 502, "INVALID_RESPONSE");
  const envelope = payload as Envelope;
  // Never expose arbitrary upstream error text, keys, or account details.
  if (envelope.success === false) {
    throw new FleexaError("Provider request failed", 502, "UPSTREAM_ERROR");
  }

  return payload as Record<string, unknown>;
}

/* ------------------------------------------------------------------ */
/* Tolerant extraction helpers                                          */
/* The envelope shape is documented, but resource payloads evolve, so    */
/* fields are read across known aliases.                                 */
/* ------------------------------------------------------------------ */

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
  return typeof value === "object" && value !== null ? (value as UnknownRecord) : {};
}

function unwrap(path: string[], value: unknown): unknown {
  let current = value;
  for (const key of path) {
    const record = asRecord(current);
    if (!(key in record)) return undefined;
    current = record[key];
  }
  return current;
}

function pickString(source: unknown, keyPaths: string[][]): string | null {
  const record = asRecord(source);
  for (const keyPath of keyPaths) {
    const value = unwrap(keyPath, record);
    if (typeof value === "string" && value.length > 0) return value;
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

function pickNumber(source: unknown, keyPaths: string[][]): number | null {
  const record = asRecord(source);
  for (const keyPath of keyPaths) {
    const value = unwrap(keyPath, record);
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && /^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(value.trim())) {
      const parsed = Number(value.trim());
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function listFrom(source: unknown, keys: string[] = ["data","apps","services","products","items","numbers","list","rows"], required = false): UnknownRecord[] {
  if (Array.isArray(source)) return source.map((item) => asRecord(item));
  const record = asRecord(source);
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) return value.map((item) => asRecord(item));
  }
  // Some responses wrap a resource-specific list in a `data` object.
  const nested = asRecord(record.data);
  for (const key of keys) {
    if (Array.isArray(nested[key])) return (nested[key] as unknown[]).map((item) => asRecord(item));
  }
  if (required) throw new FleexaError("Unexpected catalog response", 502, "INVALID_CATALOG");
  return [];
}

/* ------------------------------------------------------------------ */
/* Account                                                             */
/* ------------------------------------------------------------------ */

export type FleexaProfile = {
  email: string | null;
  name: string | null;
};

export async function getFleexaProfile(): Promise<FleexaProfile> {
  const res = await fleexaFetch("/profile");
  const record = asRecord(res.data) && res.data ? asRecord(res.data) : asRecord(res.user) && res.user ? asRecord(res.user) : res;
  return {
    email: pickString(record, [["email"], ["data", "email"], ["user", "email"], ["profile", "email"]]),
    name: pickString(record, [["name"], ["username"], ["full_name"]]),
  };
}

export type FleexaBalance = { balance: number | null; currency: string };

export async function getFleexaBalance(): Promise<FleexaBalance> {
  const res = await fleexaFetch("/balance");
  const data = res.data ? asRecord(res.data) : res;
  return {
    balance: pickNumber(data, [["balance"], ["balance_ngn"], ["amount"], ["wallet_balance"]]),
    currency: pickString(data, [["currency"]]) ?? "NGN",
  };
}

/* ------------------------------------------------------------------ */
/* SMS OTP                                                             */
/* ------------------------------------------------------------------ */

export type FleexaSmsService = {
  id: string | null;
  name: string | null;
  country: string | null;
  priceNgn: number | null;
  stock: number | null;
};

export async function listFleexaSmsServices(): Promise<FleexaSmsService[]> {
  const res = await fleexaFetch("/sms4/apps");
  return listFrom(res, undefined, true).map((item) => ({
    id: pickString(item, [["id"], ["app_id"], ["service_id"], ["code"], ["slug"], ["serviceName"]]),
    name: pickString(item, [["name"], ["app_name"], ["service"], ["title"], ["serviceName"]]),
    country: pickString(item, [["country"], ["country_code"]]),
    priceNgn: pickNumber(item, [["price_ngn"], ["price"], ["rate"], ["amount"]]),
    stock: pickNumber(item, [["stock"], ["available"], ["count"], ["quantity"]]),
  }));
}

export async function getFleexaSmsPrices(): Promise<FleexaSmsService[]> {
  const res = await fleexaFetch("/sms4/prices");
  return listFrom(res).map((item) => ({
    id: pickString(item, [["id"], ["app_id"], ["service_id"], ["code"]]),
    name: pickString(item, [["name"], ["app_name"], ["service"]]),
    country: pickString(item, [["country"], ["country_code"]]),
    priceNgn: pickNumber(item, [["price_ngn"], ["price"], ["rate"]]),
    stock: pickNumber(item, [["stock"], ["available"], ["count"]]),
  }));
}

export type FleexaSmsOrder = {
  requestId: string;
  number: string;
  service: string | null;
  country: string | null;
  priceNgn: number | null;
  expiresAt: string | null;
  raw: UnknownRecord;
};

export async function buyFleexaSmsNumber(params: {
  app?: string;
  country?: string;
}): Promise<FleexaSmsOrder> {
  const body: Record<string, unknown> = {};
  if (params.app) body.app = params.app;
  if (params.country) body.country = params.country;

  const res = await fleexaFetch("/sms4/buy", { method: "POST", body });
  const data = res.data ? asRecord(res.data) : res;

  const requestId = pickString(data, [
    ["request_id"], ["requestId"], ["order_id"], ["id"], ["reference"],
  ]);
  const number = pickString(data, [
    ["phone_number"], ["phone"], ["number"], ["msisdn"], ["virtual_number"], ["sim_number"],
  ]);

  if (!requestId || !number) throw new FleexaError("Provider receipt is incomplete and needs reconciliation", 502, "INCOMPLETE_RECEIPT");

  return {
    requestId,
    number,
    service: pickString(data, [["service"], ["app_name"], ["app"]]),
    country: pickString(data, [["country"], ["country_code"]]),
    priceNgn: pickNumber(data, [["price_ngn"], ["price"], ["rate"], ["amount"]]),
    expiresAt: pickString(data, [["expires_at"], ["deadline"], ["valid_until"]]),
    raw: data,
  };
}

export type FleexaSmsCode = {
  code: string | null;
  message: string | null;
  status: string;
  raw: UnknownRecord;
};

export async function checkFleexaSms(requestId: string): Promise<FleexaSmsCode> {
  const res = await fleexaFetch(`/sms4/check/${encodeURIComponent(requestId)}`);
  const data = res.data ? asRecord(res.data) : (res.sms ?? res);

  const code = pickString(data, [
    ["code"], ["otp"], ["sms_code"], ["verification_code"], ["sms_body", "code"],
  ]);
  const message = pickString(data, [
    ["message"], ["sms"], ["sms_text"], ["text"], ["full_sms"], ["body"],
  ]);
  const status = pickString(data, [["status"], ["state"]]) ?? (code ? "delivered" : "pending");

  return { code: code ?? null, message, status, raw: asRecord(data) };
}

export async function cancelFleexaSms(requestId: string): Promise<void> {
  await fleexaFetch("/sms4/cancel", { method: "POST", body: { request_id: requestId } });
}

/* ------------------------------------------------------------------ */
/* Email OTP                                                           */
/* ------------------------------------------------------------------ */

export type FleexaEmailProduct = {
  id: string | null;
  name: string | null;
  domain: string | null;
  priceNgn: number | null;
  stock: number | null;
};

export async function listFleexaEmailProducts(): Promise<FleexaEmailProduct[]> {
  const res = await fleexaFetch("/email/products");
  return listFrom(res, undefined, true).map((item) => ({
    id: pickString(item, [["id"], ["product_id"], ["code"], ["slug"]]),
    name: pickString(item, [["name"], ["product_name"], ["title"]]),
    domain: pickString(item, [["domain"], ["email_domain"]]),
    priceNgn: pickNumber(item, [["price_ngn"], ["price"], ["rate"]]),
    stock: pickNumber(item, [["stock"], ["available"], ["count"]]),
  }));
}

export type FleexaEmailOrder = {
  emailId: string;
  address: string;
  expiresAt: string | null;
  raw: UnknownRecord;
};

export async function buyFleexaEmail(params: { product?: string } = {}): Promise<FleexaEmailOrder> {
  const body: Record<string, unknown> = {};
  if (params.product) body.product = params.product;

  const res = await fleexaFetch("/email/buy", { method: "POST", body });
  const data = res.data ? asRecord(res.data) : res;

  const emailId = pickString(data, [["email_id"], ["emailId"], ["id"], ["request_id"]]);
  const address = pickString(data, [["email"], ["address"], ["email_address"], ["mail"]]);

  if (!emailId || !address) throw new FleexaError("Provider receipt is incomplete and needs reconciliation", 502, "INCOMPLETE_RECEIPT");

  return {
    emailId,
    address,
    expiresAt: pickString(data, [["expires_at"], ["valid_until"], ["deadline"]]),
    raw: data,
  };
}

export type FleexaEmailMessage = {
  subject: string | null;
  from: string | null;
  body: string | null;
  code: string | null;
  receivedAt: string | null;
};

export async function checkFleexaEmail(emailId: string): Promise<{
  messages: FleexaEmailMessage[];
  code: string | null;
  raw: UnknownRecord;
}> {
  const res = await fleexaFetch(`/email/check/${encodeURIComponent(emailId)}`);
  const data = res.data ? asRecord(res.data) : res;

  const messages = listFrom(data, ["messages", "mails", "emails", "data", "items"]).map((item) => ({
    subject: pickString(item, [["subject"], ["title"]]),
    from: pickString(item, [["from"], ["sender"], ["from_address"]]),
    body: pickString(item, [["body"], ["text"], ["content"], ["html"]]),
    code: pickString(item, [["code"], ["otp"], ["otp_code"]]),
    receivedAt: pickString(item, [["received_at"], ["created_at"], ["date"]]),
  }));

  const directCode =
    pickString(data, [["code"], ["otp"], ["otp_code"]]) ?? messages.find((m) => m.code)?.code ?? null;

  return { messages, code: directCode, raw: data };
}

export async function cancelFleexaEmail(emailId: string): Promise<void> {
  await fleexaFetch("/email/cancel", {
    method: "POST",
    body: { email_id: emailId },
  });
}

/* ------------------------------------------------------------------ */
/* Rentals                                                             */
/* ------------------------------------------------------------------ */

export type FleexaRentArea = {
  id: string | null;
  country: string | null;
  pricePerMonthNgn: number | null;
  stock: number | null;
};

export async function listFleexaRentAreas(): Promise<FleexaRentArea[]> {
  const res = await fleexaFetch("/rent/sms4/areas");
  return listFrom(res, ["areas", "countries", "data", "items"], true).map((item) => ({
    id: pickString(item, [["id"], ["area_id"], ["code"], ["country_code"], ["country"]]),
    country: pickString(item, [["country_code"], ["country"], ["country_name"], ["name"]]),
    pricePerMonthNgn: pickNumber(item, [["price_ngn"], ["price"], ["rate"], ["monthly_price"]]),
    stock: pickNumber(item, [["stock"], ["available"], ["count"]]),
  }));
}

export type FleexaRentOrder = {
  rentalId: string;
  number: string;
  months: number;
  expiresAt: string | null;
  raw: UnknownRecord;
};

export async function buyFleexaRental(params: {
  area?: string;
  months?: number;
}): Promise<FleexaRentOrder> {
  const body: Record<string, unknown> = {};
  if (params.area) body.area = params.area;
  if (params.months) body.months = params.months;

  const res = await fleexaFetch("/rent/sms4/buy", { method: "POST", body });
  const data = res.data ? asRecord(res.data) : res;

  const rentalId = pickString(data, [
    ["rental_id"], ["id"], ["rent_id"], ["request_id"], ["number_id"],
  ]);
  const number = pickString(data, [
    ["phone_number"], ["phone"], ["number"], ["msisdn"], ["rental_number"],
  ]);

  if (!rentalId || !number) throw new FleexaError("Provider receipt is incomplete and needs reconciliation", 502, "INCOMPLETE_RECEIPT");

  return {
    rentalId,
    number,
    months: params.months ?? 1,
    expiresAt: pickString(data, [["expires_at"], ["end_date"], ["valid_until"]]),
    raw: data,
  };
}

export type FleexaRentalNumber = {
  id: string | null;
  number: string | null;
  area: string | null;
  expiresAt: string | null;
};

export async function listFleexaRentals(): Promise<FleexaRentalNumber[]> {
  const res = await fleexaFetch("/rent/sms4/numbers");
  return listFrom(res, ["numbers", "rentals", "data", "items"]).map((item) => ({
    id: pickString(item, [["id"], ["rental_id"], ["rent_id"], ["number_id"]]),
    number: pickString(item, [["phone_number"], ["phone"], ["number"], ["msisdn"]]),
    area: pickString(item, [["area"], ["country"], ["country_name"]]),
    expiresAt: pickString(item, [["expires_at"], ["end_date"], ["valid_until"]]),
  }));
}

export async function getFleexaRentalSms(rentalId: string): Promise<{
  messages: Array<{ from: string | null; body: string | null; code: string | null; at: string | null }>;
  raw: UnknownRecord;
}> {
  const res = await fleexaFetch(
    `/rent/sms4/sms?id=${encodeURIComponent(rentalId)}&request_id=${encodeURIComponent(rentalId)}`,
  );
  const data = res.data ? asRecord(res.data) : res;

  const messages = listFrom(data, ["sms", "messages", "data", "items"]).map((item) => ({
    from: pickString(item, [["from"], ["sender"]]),
    body: pickString(item, [["message"], ["body"], ["text"], ["sms_text"]]),
    code: pickString(item, [["code"], ["otp"], ["otp_code"]]),
    at: pickString(item, [["received_at"], ["created_at"], ["date"]]),
  }));

  return { messages, raw: data };
}

/* ------------------------------------------------------------------ */
/* Status                                                              */
/* ------------------------------------------------------------------ */

export type FleexaStatus = {
  configured: boolean;
  online: boolean;
  balanceNgn: number | null;
  baseUrl: string;
  testedAt: string;
  error?: string;
};

export async function getFleexaStatus(): Promise<FleexaStatus> {
  const base = baseUrl();
  if (!isFleexaConfigured()) {
    return {
      configured: false,
      online: false,
      balanceNgn: null,
      baseUrl: base,
      testedAt: new Date().toISOString(),
    };
  }

  try {
    const balance = await getFleexaBalance();
    return {
      configured: true,
      online: true,
      balanceNgn: balance.balance,
      baseUrl: base,
      testedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      configured: true,
      online: false,
      balanceNgn: null,
      baseUrl: base,
      testedAt: new Date().toISOString(),
      error: error instanceof FleexaError ? error.message : "Unreachable",
    };
  }
}

/* ------------------------------------------------------------------ */
/* Proxies                                                             */
/*                                                                     */
/* Endpoint shapes are NOT published. They follow the same convention  */
/* as the SMS, email and rental paths above (`/sms4/buy`,             */
/* `/email/buy`, `/rent/sms4/buy`), which is evidence of a house style */
/* and nothing more — and the supplier's own endpoint list omits the   */
/* proxy family entirely, so the prior is now negative rather than     */
/* merely unknown. Product ids are deployment data, not code, so a     */
/* plan is only mapped to a supplier product through                   */
/* `FLEEXA_PROXY_PRODUCTS`, and nothing is sellable until that map is  */
/* present and `FLEEXA_PROXY_ENABLED=1`. See PROXIES.md for what to do */
/* before any of this touches money.                                   */
/* ------------------------------------------------------------------ */

/** Endpoint prefix. One place to change if Fleexa documents a different path. */
const PROXY_PATH = "/proxy";

export type FleexaProxyProduct = {
  productId: string;
  name: string | null;
  gigabytes: number | null;
  days: number | null;
  region: string | null;
  /** What this costs us. Never rendered to a customer. */
  priceNgn: number | null;
};

export type FleexaProxyAccess = {
  accessId: string;
  host: string | null;
  port: number | null;
  username: string | null;
  password: string | null;
  protocol: "http" | "https" | "socks5";
  expiresAt: Date | null;
  limitGb: number | null;
  usedGb: number | null;
};

export type ProxyPlanMap = Record<string, string>;

/**
 * The deployment's plan→product map.
 *
 * Absent or malformed means "no proxy products", which is the safe direction: a
 * plan with no product id cannot be bought, and a typo cannot silently point two
 * plans at one product.
 */
export function fleexaProxyPlanMap(): ProxyPlanMap {
  const raw = process.env.FLEEXA_PROXY_PRODUCTS?.trim();
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const map: ProxyPlanMap = {};
    for (const [slug, productId] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof slug === "string" && typeof productId === "string" && productId.trim()) {
        map[slug] = productId.trim();
      }
    }
    return map;
  } catch {
    return {};
  }
}

export async function listFleexaProxyProducts(): Promise<FleexaProxyProduct[]> {
  const payload = await fleexaFetch(`${PROXY_PATH}/products`);
  return listFrom(payload).slice(0, 500).flatMap((row) => {
    const productId = pickString(row, [["product_id"], ["productId"], ["id"], ["plan_id"]]);
    if (!productId) return [];
    return [{
      productId,
      name: pickString(row, [["name"], ["title"], ["plan"]]),
      gigabytes: pickNumber(row, [["gigabytes"], ["gb"], ["bandwidth_gb"], ["data_gb"]]),
      days: pickNumber(row, [["days"], ["duration_days"], ["validity_days"], ["validity"]]),
      region: pickString(row, [["region"], ["country"], ["country_code"], ["location"]]),
      priceNgn: pickNumber(row, [["price_ngn"], ["price"], ["amount_ngn"], ["amount"]]),
    }];
  });
}

function protocolOf(value: string | null): FleexaProxyAccess["protocol"] {
  const normalised = (value ?? "").toLowerCase();
  if (normalised.includes("socks5") || normalised === "socks") return "socks5";
  if (normalised.includes("https")) return "https";
  return "http";
}

function accessFrom(row: UnknownRecord): FleexaProxyAccess | null {
  const accessId = pickString(row, [["access_id"], ["accessId"], ["order_id"], ["orderId"], ["id"]]);
  if (!accessId) return null;
  const expires = pickString(row, [["expires_at"], ["expiresAt"], ["expiry"], ["valid_until"]]);
  const parsedExpiry = expires ? new Date(expires) : null;
  return {
    accessId,
    host: pickString(row, [["host"], ["proxy_host"], ["gateway"], ["server"]]),
    port: pickNumber(row, [["port"], ["proxy_port"]]),
    username: pickString(row, [["username"], ["user"], ["login"]]),
    password: pickString(row, [["password"], ["pass"]]),
    protocol: protocolOf(pickString(row, [["protocol"], ["type"]])),
    expiresAt: parsedExpiry && Number.isFinite(parsedExpiry.getTime()) ? parsedExpiry : null,
    limitGb: pickNumber(row, [["limit_gb"], ["bandwidth_gb"], ["gigabytes"], ["quota_gb"]]),
    usedGb: pickNumber(row, [["used_gb"], ["usage_gb"], ["traffic_used_gb"], ["used"]]),
  };
}

/**
 * Buy one proxy allowance.
 *
 * `reference` is sent as our own idempotency key where the supplier accepts one:
 * a retried request must not open a second sub-user, because the second one is
 * billable bandwidth nobody ordered.
 */
export async function buyFleexaProxy(input: {
  productId: string;
  reference: string;
  gigabytes: number;
  days: number;
}): Promise<FleexaProxyAccess> {
  const payload = await fleexaFetch(`${PROXY_PATH}/buy`, {
    method: "POST",
    body: {
      product_id: input.productId,
      reference: input.reference,
      gigabytes: input.gigabytes,
      days: input.days,
    },
  });
  const row = listFrom(payload)[0] ?? asRecord(payload.data ?? payload);
  const access = accessFrom(row);
  if (!access) throw new FleexaError("Unexpected provider response", 502, "INVALID_PROXY_ACCESS");
  return access;
}

/** Read back one allowance — the quota check and the usage figure. */
export async function checkFleexaProxy(accessId: string): Promise<FleexaProxyAccess | null> {
  const payload = await fleexaFetch(`${PROXY_PATH}/check/${encodeURIComponent(accessId)}`);
  const row = listFrom(payload)[0] ?? asRecord(payload.data ?? payload);
  return accessFrom(row);
}

/** Release an allowance we bought but could not hand over. */
export async function cancelFleexaProxy(accessId: string): Promise<void> {
  await fleexaFetch(`${PROXY_PATH}/cancel`, { method: "POST", body: { access_id: accessId } });
}
