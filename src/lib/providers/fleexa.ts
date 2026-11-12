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
 *   • Proxies     — GET /proxy/status, GET /proxy/plans, POST /proxy/order,
 *                   GET /proxy/orders/:id, POST /proxy/orders/:id/extract
 *   • Account     — GET /profile, GET /balance
 *
 * Auth: `Authorization: Bearer flx_live_...` or X-API-Key.
 * Envelope: `{ success, message, error_code, details, http_code }`.
 * Prices: NGN, already reseller-discounted for API keys (`price_ngn` / `rate`).
 * Rate limit: 60 requests / minute / key (HTTP 429).
 * Poll OTP endpoints every 20–30 seconds.
 */

import "server-only";
import { createRateLimiter } from "@/lib/platform/rate-limit";
import { readJsonWithLimit } from "@/lib/platform/request-body";
import { ProviderError, looksLikeFundingRefusal } from "@/lib/providers/types";
import { emailTextForCode, extractVerificationCode } from "@/lib/services/email-otp/verification-code";

const DEFAULT_BASE_URL = "https://fleexa.com.ng/developer";
const REQUEST_TIMEOUT_MS = 20_000;
// Fleexa documents 60 requests/minute/key. The 25-per-window shared budget
// leaves boundary headroom, but cannot account for manual calls or network delay.
const supplierBudget = createRateLimiter({ windowMs: 60_000, maxRequests: 25 });

export class FleexaError extends ProviderError {
  constructor(message: string, status: number = 502, code: string = "FLEEXA_ERROR") {
    super(message, { provider: "fleexa", status, code });
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

/**
 * The parts of a refusal that may say "not enough balance": message, code, and
 * details rendered flat. Joined only so one regex can read them.
 */
function refusalText(payload: unknown): string {
  if (typeof payload === "string") return payload;
  if (!payload || typeof payload !== "object") return "";
  const record = payload as Record<string, unknown>;
  const parts = [record.message, record.error, record.error_code, record.detail, record.details]
    .map((value) => (typeof value === "string" ? value : value && typeof value === "object" ? JSON.stringify(value) : ""))
    .filter(Boolean);
  return parts.join(" | ").slice(0, 2_000);
}

async function fleexaFetch(
  path: string,
  init: { method?: "GET" | "POST"; body?: Record<string, unknown>; idempotencyKey?: string } = {},
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
        ...(init.idempotencyKey ? { "Idempotency-Key": init.idempotencyKey } : {}),
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
    if (response.status === 429) {
      await response.body?.cancel().catch(() => {});
      throw new FleexaError("Provider request failed", 429, "RATE_LIMITED");
    }
    // Read the refusal before discarding it: an unfunded account is refused with
    // a 4xx and a sentence, and that sentence is the difference between "retry
    // later" and "top the account up". The text is classified, never forwarded.
    const detail = await readJsonWithLimit(response, 16_384).catch(() => null);
    if (response.status === 402 || looksLikeFundingRefusal(refusalText(detail))) {
      throw new FleexaError("Provider balance is insufficient", 402, "INSUFFICIENT_BALANCE");
    }
    throw new FleexaError("Provider request failed", 502, "UPSTREAM_ERROR");
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
    // ...but do read it far enough to tell a refusal from an outage.
    if (looksLikeFundingRefusal(refusalText(envelope))) {
      throw new FleexaError("Provider balance is insufficient", 402, "INSUFFICIENT_BALANCE");
    }
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

  const messages = listFrom(data, ["messages", "mails", "emails", "data", "items"]).map((item) => {
    const subject = pickString(item, [["subject"], ["title"]]);
    const body = pickString(item, [["body"], ["text"], ["content"], ["html"], ["html_body"], ["text_body"], ["message"]]);
    const explicitCode = pickString(item, [["code"], ["otp"], ["otp_code"]]);
    return {
      subject,
      from: pickString(item, [["from"], ["sender"], ["from_address"], ["sender_email"]]),
      body,
      code: explicitCode ?? extractVerificationCode(subject, emailTextForCode(body)),
      receivedAt: pickString(item, [["received_at"], ["created_at"], ["date"]]),
    };
  });

  const explicitCode = pickString(data, [["code"], ["otp"], ["otp_code"]]);
  const directCode = explicitCode
    ?? messages.find((message) => message.code)?.code
    ?? extractVerificationCode(
      pickString(data, [["subject"], ["title"]]),
      emailTextForCode(pickString(data, [["body"], ["text"], ["content"], ["html"], ["html_body"], ["text_body"]])),
    );

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
}, onAccepted?: (rentalId: string) => Promise<void>): Promise<FleexaRentOrder> {
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

  // Preserve a returned reference before rejecting a partially populated
  // receipt. The call may already have spent supplier funds.
  if (rentalId) await onAccepted?.(rentalId);
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
/* Residential proxies                                                 */
/* ------------------------------------------------------------------ */

export type FleexaProxyStatus = {
  enabled: boolean;
  currency: "NGN";
  expiryHours: number;
  planCount: number;
  countryCount: number;
};
export type FleexaProxyPlan = {
  id: string;
  label: string;
  quantity: number;
  priceNgn: number;
  perIpNgn: number;
};
export type FleexaProxyCountry = { code: string; name: string; states: string[] };
export type FleexaProxyCatalogue = {
  status: FleexaProxyStatus;
  plans: FleexaProxyPlan[];
  categories: { id: string; name: string; type: number; description: string }[];
  countries: FleexaProxyCountry[];
};
export type FleexaProxyCredentials = {
  host: string;
  port: number;
  username: string;
  password: string;
  url: string;
};
export type FleexaProxySlot = {
  id: string;
  status: "purchased" | "active" | "expired" | "stopped";
  country: string;
  amountPaid: number;
  currency: string;
  proxyType: number;
  extractRequired: boolean;
  expiresAt: string | null;
  credentials: FleexaProxyCredentials | null;
};

function proxyData(payload: Record<string, unknown>): UnknownRecord {
  const value = asRecord(payload.data);
  if (!Object.keys(value).length) throw new FleexaError("Invalid proxy response", 502, "INVALID_PROXY_RESPONSE");
  return value;
}
function proxyString(value: unknown, max = 160): string {
  if (typeof value !== "string" || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) throw new FleexaError("Invalid proxy response", 502, "INVALID_PROXY_RESPONSE");
  return value.trim();
}
function proxyInt(value: unknown, min = 0, max = 2_147_483_647): number {
  const parsed = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(parsed) || (parsed as number) < min || (parsed as number) > max) throw new FleexaError("Invalid proxy response", 502, "INVALID_PROXY_RESPONSE");
  return parsed as number;
}
function parseProxyPlan(value: unknown): FleexaProxyPlan {
  const row = asRecord(value);
  return {
    id: proxyString(row.id, 80), label: proxyString(row.label, 100),
    quantity: proxyInt(row.quantity, 1, 100), priceNgn: proxyInt(row.price_ngn, 1),
    perIpNgn: proxyInt(row.per_ip_ngn, 1),
  };
}
function parseProxyCountry(value: unknown): FleexaProxyCountry {
  const row = asRecord(value);
  if (!Array.isArray(row.states)) throw new FleexaError("Invalid proxy response", 502, "INVALID_PROXY_RESPONSE");
  return { code: proxyString(row.code, 2).toUpperCase(), name: proxyString(row.name, 100), states: row.states.map((state) => proxyString(state, 100)) };
}
function parseProxyCredentials(value: unknown): FleexaProxyCredentials | null {
  if (value === null || value === undefined) return null;
  const row = asRecord(value);
  return {
    host: proxyString(row.host, 255), port: proxyInt(row.port, 1, 65535),
    username: proxyString(row.username, 255), password: proxyString(row.password, 512),
    url: proxyString(row.url, 1200),
  };
}
function parseProxySlot(value: unknown, defaults: { country?: string; amountPaid?: number; currency?: string; proxyType?: number } = {}): FleexaProxySlot {
  const row = asRecord(value);
  const status = row.status;
  if (status !== "purchased" && status !== "active" && status !== "expired" && status !== "stopped") throw new FleexaError("Invalid proxy response", 502, "INVALID_PROXY_RESPONSE");
  const expiresAt = row.expires_at;
  if (expiresAt !== null && expiresAt !== undefined && (typeof expiresAt !== "string" || !Number.isFinite(Date.parse(expiresAt)))) throw new FleexaError("Invalid proxy response", 502, "INVALID_PROXY_RESPONSE");
  return {
    id: proxyString(row.id, 100), status, country: proxyString(row.country ?? defaults.country, 2).toUpperCase(),
    amountPaid: proxyInt(row.amount_paid ?? defaults.amountPaid ?? 0, 0), currency: proxyString(row.currency ?? defaults.currency ?? "NGN", 3).toUpperCase(),
    proxyType: proxyInt(row.proxy_type ?? defaults.proxyType ?? 2, 2, 3), extractRequired: row.extract_required === true,
    expiresAt: typeof expiresAt === "string" ? expiresAt : null,
    credentials: parseProxyCredentials(row.credentials),
  };
}

export async function getFleexaProxyCatalogue(): Promise<FleexaProxyCatalogue> {
  const [statusPayload, plansPayload] = await Promise.all([fleexaFetch("/proxy/status"), fleexaFetch("/proxy/plans")]);
  const status = proxyData(statusPayload), plansData = proxyData(plansPayload);
  if (status.enabled !== true || status.currency !== "NGN" || !Array.isArray(plansData.plans) || !Array.isArray(plansData.countries) || !Array.isArray(plansData.categories)) {
    throw new FleexaError("Proxy catalogue is unavailable", 503, "PROXY_UNAVAILABLE");
  }
  const expiryHours = proxyInt(status.expiry_hours, 1, 6);
  const plans = plansData.plans.map(parseProxyPlan);
  const countries = plansData.countries.map(parseProxyCountry);
  const categories = plansData.categories.map((value) => {
    const row = asRecord(value);
    return { id: proxyString(row.id, 80), name: proxyString(row.name, 120), type: proxyInt(row.type, 1, 10), description: proxyString(row.description, 300) };
  });
  if (!plans.length || !countries.length) throw new FleexaError("Proxy catalogue is empty", 503, "PROXY_UNAVAILABLE");
  return {
    status: { enabled: true, currency: "NGN", expiryHours, planCount: proxyInt(status.plan_count), countryCount: proxyInt(status.country_count) },
    plans, countries, categories,
  };
}

export async function buyFleexaProxy(input: { planId: string; country: string; state: string; proxyType: 2 | 3; idempotencyKey: string }): Promise<{ transactionId: string; reference: string; amountPaid: number; currency: string; slots: FleexaProxySlot[] }> {
  const result = await fleexaFetch("/proxy/order", {
    method: "POST", idempotencyKey: input.idempotencyKey,
    body: { plan_id: input.planId, country: input.country, ...(input.state ? { state: input.state } : {}), proxy_type: input.proxyType },
  });
  const data = proxyData(result);
  if (!Array.isArray(data.slots)) throw new FleexaError("Invalid proxy order receipt", 502, "INVALID_PROXY_RESPONSE");
  return {
    transactionId: proxyString(data.transaction_id, 100), reference: proxyString(data.reference, 160),
    amountPaid: proxyInt(data.amount_paid, 1), currency: proxyString(data.currency, 3).toUpperCase(),
    slots: data.slots.map((slot) => parseProxySlot(slot, { country: typeof data.country === "string" ? data.country : input.country, amountPaid: proxyInt(data.amount_paid, 1), currency: typeof data.currency === "string" ? data.currency : "NGN", proxyType: input.proxyType })),
  };
}

export async function extractFleexaProxy(slotId: string, defaults: { country?: string; proxyType?: number } = {}): Promise<FleexaProxySlot> {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(slotId)) throw new FleexaError("Invalid proxy identifier", 400, "INVALID_PROXY_ID");
  const payload = await fleexaFetch(`/proxy/orders/${encodeURIComponent(slotId)}/extract`, { method: "POST", body: {} });
  const data = proxyData(payload);
  const parsed = parseProxySlot({ ...data, country: data.country ?? defaults.country, currency: data.currency ?? "NGN", amount_paid: data.amount_paid ?? 0, proxy_type: data.proxy_type ?? defaults.proxyType ?? 2 }, defaults);
  if (parsed.status !== "active" || !parsed.credentials) throw new FleexaError("Proxy credentials are not available", 502, "INVALID_PROXY_RESPONSE");
  return parsed;
}

export async function getFleexaProxySlot(slotId: string, defaults: { country?: string; proxyType?: number } = {}): Promise<FleexaProxySlot> {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(slotId)) throw new FleexaError("Invalid proxy identifier", 400, "INVALID_PROXY_ID");
  const payload = await fleexaFetch(`/proxy/orders/${encodeURIComponent(slotId)}`);
  const data = proxyData(payload);
  return parseProxySlot({ ...data, country: data.country ?? defaults.country, currency: data.currency ?? "NGN", amount_paid: data.amount_paid ?? 0, proxy_type: data.proxy_type ?? defaults.proxyType ?? 2 }, defaults);
}

export async function revealFleexaProxy(slotId: string, defaults: { country?: string; proxyType?: number } = {}): Promise<FleexaProxySlot> {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(slotId)) throw new FleexaError("Invalid proxy identifier", 400, "INVALID_PROXY_ID");
  const payload = await fleexaFetch(`/proxy/orders/${encodeURIComponent(slotId)}/reveal`, { method: "POST", body: {} });
  const data = proxyData(payload);
  const parsed = parseProxySlot({ ...data, country: data.country ?? defaults.country, currency: data.currency ?? "NGN", amount_paid: data.amount_paid ?? 0, proxy_type: data.proxy_type ?? defaults.proxyType ?? 2 }, defaults);
  if (parsed.status !== "active" || !parsed.credentials) throw new FleexaError("Proxy credentials are not available", 409, "PROXY_CREDENTIALS_UNAVAILABLE");
  return parsed;
}
