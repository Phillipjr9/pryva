/**
 * Fleexa developer API client.
 *
 * Docs: https://fleexa.com.ng/docs — single REST API for
 *   • SMS OTP     — GET /sms4/apps, GET /sms4/prices, POST /sms4/buy,
 *                   GET /sms4/check/:requestId, POST /sms4/cancel
 *   • Email OTP   — GET /email/products, POST /email/buy,
 *                   GET /email/check/:emailId, POST /email/cancel
 *   • Rentals     — GET /rent/sms4/areas, POST /rent/sms4/buy,
 *                   GET /rent/sms4/numbers, GET /rent/sms4/sms
 *   • Account     — GET /profile, GET /balance
 *
 * Auth: `Authorization: Bearer flx_live_...` or X-API-Key.
 * Envelope: `{ success, message, error_code, details, http_code }`.
 * Prices: NGN, already reseller-discounted for API keys (`price_ngn` / `rate`).
 * Rate limit: 60 requests / minute / key (HTTP 429).
 * Poll OTP endpoints every 20–30 seconds.
 */

const DEFAULT_BASE_URL = "https://fleexa.com.ng/developer";
const REQUEST_TIMEOUT_MS = 20_000;

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
  return (process.env.FLEEXA_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, "");
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
  const key = fleexaApiKey();
  if (!key) throw new FleexaError("FLEEXA_API_KEY is not configured", 500, "NO_API_KEY");

  let response: Response;
  try {
    response = await fetch(`${baseUrl()}${path}`, {
      method: init.method ?? "GET",
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

  let payload: Envelope | null = null;
  try {
    payload = (await response.json()) as Envelope;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw new FleexaError(
      payload?.message ?? `Fleexa request failed (HTTP ${response.status})`,
      response.status,
      payload?.error_code,
    );
  }
  if (payload && payload.success === false) {
    throw new FleexaError(
      payload.message ?? "Fleexa rejected the request",
      typeof payload.http_code === "number" ? payload.http_code : 400,
      payload.error_code,
    );
  }

  return payload ?? {};
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
    if (typeof value === "string") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function listFrom(source: unknown, keys: string[] = ["data","apps","services","products","items","numbers","list","rows"]): UnknownRecord[] {
  if (Array.isArray(source)) return source.map((item) => asRecord(item));
  const record = asRecord(source);
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) return value.map((item) => asRecord(item));
  }
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
  return listFrom(res).map((item) => ({
    id: pickString(item, [["id"], ["app_id"], ["service_id"], ["code"], ["slug"]]),
    name: pickString(item, [["name"], ["app_name"], ["service"], ["title"]]),
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

  if (!requestId) throw new FleexaError("Fleexa did not return a request id", 502, "NO_REQUEST_ID");

  return {
    requestId,
    number: number ?? "Assigned — refresh in a moment",
    service: pickString(data, [["service"], ["app_name"], ["app"]]) ?? params.app ?? null,
    country: pickString(data, [["country"], ["country_code"]]) ?? params.country ?? null,
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
  return listFrom(res).map((item) => ({
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

  if (!address) throw new FleexaError("Fleexa did not return an email address", 502, "NO_EMAIL");

  return {
    emailId: emailId ?? address,
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
  return listFrom(res, ["areas", "countries", "data", "items"]).map((item) => ({
    id: pickString(item, [["id"], ["area_id"], ["code"], ["country_code"], ["country"]]),
    country: pickString(item, [["country"], ["name"], ["country_name"]]),
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

  if (!rentalId) throw new FleexaError("Fleexa did not return a rental id", 502, "NO_RENTAL_ID");

  return {
    rentalId,
    number: number ?? "Assigned — refresh in a moment",
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
