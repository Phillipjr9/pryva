/**
 * Marketplace account supplier client — SERVER ONLY.
 *
 * Contract: https://bulkacc.com/Api  (retrieved 2026-10-28)
 * Base URL: https://bulkacc.com
 * Auth:     `apiKey` query parameter, key from the reseller account page.
 * Format:   JSON envelope `{ data, statusCode, message }`.
 *
 *   GET  /api/products/list?apiKey=&pageIndex=&pageSize=
 *        → data.items[{ code, name, description, categoryName, groupName,
 *                       inStock, min, price }], totalCount, totalPages
 *   GET  /api/products?apiKey=&productCode=      → data{ code, name, inStock, min, price }
 *   POST /api/orders?apiKey=&productCode=&quantity=  → data = orderCode string
 *   GET  /api/orders?apiKey=&orderCode=          → data[{ accountInformation }]
 *   GET  /api/accounts?apiKey=                   → data = balance number (USD)
 *
 * Four properties of this contract drive the design below:
 *
 *  1. **A failed order still returns HTTP 200 and `statusCode: 200`.** The
 *     documented insufficient-balance response is `{ data: null, statusCode: 200,
 *     message: "insufficient account balance!" }`. Success is therefore decided
 *     by `data` holding a non-empty order code — never by the status code.
 *  2. **The API key travels in the query string.** URLs are never logged; only
 *     the path is, through `safePath()`. Residual risk: the key can still appear
 *     in an upstream proxy's access log, which is the supplier's design, not
 *     something this client can fix.
 *  3. **There is no client reference or idempotency key.** A retry of
 *     `createOrder` can buy twice and spend real balance. So a timeout or an
 *     unparseable response is reported as `ambiguous_outcome` and must be held
 *     for reconciliation — never retried, never auto-refunded.
 *  4. **Prices are floats with up to five decimals** (0.06992). They are parsed
 *     through `supplier-money` into integer micro-USD, never used as floats.
 *
 * This module must never be imported by a client component: it reads a secret,
 * and the supplier's identity must not reach a browser bundle.
 */

import "server-only";
import { createRateLimiter } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";
import { usdMicros, usdStringFromMicros, SupplierMoneyError } from "@/lib/supplier-money";

const DEFAULT_BASE_URL = "https://bulkacc.com";
const REQUEST_TIMEOUT_MS = 20_000;
/** The supplier publishes no rate limit; stay conservative and cache catalogs. */
const supplierBudget = createRateLimiter({ windowMs: 60_000, maxRequests: 30 });

export class BulkaccError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "BulkaccError";
  }
}

/** True when the outcome of an order call is unknown and money may have moved. */
export function isAmbiguousOutcome(error: unknown): boolean {
  return error instanceof BulkaccError &&
    (error.code === "ambiguous_outcome" || error.code === "timeout" || error.code === "bad_response");
}

export function bulkaccApiKey(): string | null {
  const key = process.env.BULKACC_API_KEY?.trim();
  return key ? key : null;
}

export function isBulkaccConfigured(): boolean {
  return bulkaccApiKey() !== null;
}

/** Last four characters, for logs. Never the whole key. */
export function maskedKey(): string {
  const key = bulkaccApiKey();
  return key ? `…${key.slice(-4)}` : "(unset)";
}

function baseUrl(): string {
  const value = (process.env.BULKACC_API_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, "");
  try {
    const url = new URL(value);
    // Pin the host so a misconfigured base URL cannot forward the key elsewhere.
    if (url.protocol !== "https:" || url.hostname !== "bulkacc.com" || url.port ||
        url.username || url.password || url.search || url.hash) throw new Error("Invalid URL");
    return url.origin;
  } catch {
    throw new BulkaccError("Invalid supplier configuration", "invalid_base_url", 503);
  }
}

/** Path with no query string, for logs. The query carries the API key. */
function safePath(path: string): string {
  return path.split("?")[0] ?? path;
}

type Envelope = {
  data?: unknown;
  statusCode?: number;
  message?: string;
};

export type BulkaccProduct = {
  code: string;
  name: string;
  description: string | null;
  /** Top-level group, e.g. "Spotify", "Google". */
  groupName: string | null;
  /** Product line within the group. */
  categoryName: string | null;
  /** Units available. `null` means the supplier did not say — not zero. */
  inStock: number | null;
  /** Minimum order quantity for this product. */
  min: number;
  /** Wholesale price in micro-USD (integer). */
  priceMicros: number;
};

export type BulkaccProductPage = {
  items: BulkaccProduct[];
  totalCount: number;
  pageIndex: number;
  pageSize: number;
  totalPages: number;
};

function toPositiveIntOrNull(value: unknown): number | null {
  return Number.isSafeInteger(value) && (value as number) >= 0 ? (value as number) : null;
}

function parsePriceMicros(value: unknown): number {
  if (typeof value !== "number" && typeof value !== "string") {
    throw new BulkaccError("Supplier price is missing", "bad_product", 502);
  }
  try {
    const micros = usdMicros(value);
    if (micros <= 0) throw new SupplierMoneyError("non-positive price");
    return micros;
  } catch {
    throw new BulkaccError("Supplier price is unusable", "bad_product", 502);
  }
}

/** Reject anything the supplier should not be able to push into our UI. */
export function normalizeProduct(raw: unknown): BulkaccProduct {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new BulkaccError("Supplier product is malformed", "bad_product", 502);
  }
  const row = raw as Record<string, unknown>;
  const code = typeof row.code === "string" ? row.code.trim() : typeof row.code === "number" ? String(row.code) : "";
  const name = typeof row.name === "string" ? row.name.trim().slice(0, 160) : "";
  if (!/^[A-Za-z0-9_-]{1,20}$/.test(code) || !name) {
    throw new BulkaccError("Supplier product is malformed", "bad_product", 502);
  }
  const min = Number.isSafeInteger(row.min) && (row.min as number) >= 1 ? Math.min(row.min as number, 100) : 1;
  return {
    code,
    name,
    description: typeof row.description === "string" ? row.description.trim().slice(0, 600) || null : null,
    groupName: typeof row.groupName === "string" ? row.groupName.trim().slice(0, 60) || null : null,
    categoryName: typeof row.categoryName === "string" ? row.categoryName.trim().slice(0, 80) || null : null,
    inStock: toPositiveIntOrNull(row.inStock),
    min,
    priceMicros: parsePriceMicros(row.price),
  };
}

type FetchOptions = { method?: "GET" | "POST"; timeoutMs?: number };

/**
 * One request against the supplier.
 *
 * Returns the raw envelope plus the response text, because the order-creation
 * path has to salvage an order code from a body that does not parse.
 */
async function request(
  path: string,
  params: Record<string, string | number>,
  options: FetchOptions = {},
): Promise<{ envelope: Envelope | null; text: string; httpStatus: number }> {
  const key = bulkaccApiKey();
  if (!key) throw new BulkaccError("Marketplace is not configured", "not_configured", 503);

  const budget = await supplierBudget("bulkacc:shared-key-budget");
  if (budget.unavailable) throw new BulkaccError("Supplier rate limit is unavailable", "rate_limit_unavailable", 503);
  if (!budget.allowed) throw new BulkaccError("Marketplace is busy", "rate_limit_exceeded", 429);

  const url = new URL(`${baseUrl()}${path}`);
  url.searchParams.set("apiKey", key);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, String(value));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method: options.method ?? "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
      redirect: "error",
      cache: "no-store",
    });
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    // Never log the URL: it contains the key.
    logger.warn("Supplier request failed", { path: safePath(path), code: aborted ? "timeout" : "network_error" });
    throw new BulkaccError(
      aborted ? "Marketplace timed out" : "Marketplace unreachable",
      aborted ? "timeout" : "network_error",
      504,
    );
  } finally {
    clearTimeout(timeout);
  }

  const retryAfterHeader = response.headers.get("retry-after");
  const retryAfterSeconds = retryAfterHeader ? Number(retryAfterHeader) : undefined;
  const text = await response.text().catch(() => "");

  let envelope: Envelope | null = null;
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) envelope = parsed as Envelope;
  } catch {
    envelope = null;
  }

  if (!response.ok) {
    const code = response.status === 429 ? "rate_limit_exceeded"
      : response.status === 401 || response.status === 403 ? "auth_failed"
      : "http_error";
    logger.warn("Supplier request failed", { path: safePath(path), status: response.status, code });
    throw new BulkaccError(
      code === "auth_failed" ? "Marketplace credentials were rejected" : "Marketplace request failed",
      code,
      response.status,
      retryAfterSeconds,
    );
  }

  return { envelope, text, httpStatus: response.status };
}

/** Read `data` from a parsed envelope, treating a logical failure as an error. */
function readData(envelope: Envelope | null, path: string): unknown {
  if (!envelope) throw new BulkaccError("Marketplace returned a malformed response", "bad_response", 502);
  const status = Number.isSafeInteger(envelope.statusCode) ? (envelope.statusCode as number) : null;
  const message = typeof envelope.message === "string" ? envelope.message : "";
  // A logical failure can arrive with HTTP 200 and statusCode 200 (see #1 above),
  // so an explicit 4xx/5xx statusCode is the only status-based signal we trust.
  if (status !== null && status >= 400) {
    logger.warn("Supplier reported a failure", { path: safePath(path), status, code: "logical_error" });
    throw new BulkaccError(message || "Marketplace request failed", "logical_error", status);
  }
  return envelope.data;
}

/**
 * The published catalog example is not valid JSON (`"data":"312..." "statusCode":200`).
 * If a real response ever arrives that way we must still recover the order code:
 * losing it means the customer paid, we bought, and nobody can fetch the accounts.
 */
export function salvageOrderCode(text: string): string | null {
  const match = /"data"\s*:\s*"?([A-Za-z0-9_-]{6,40})"?/.exec(text);
  return match ? match[1] : null;
}

const CATALOG_TTL_MS = 30 * 60 * 1000;
const MAX_CATALOG_PAGES = 25;
const CATALOG_PAGE_SIZE = 200;

type CacheEntry = { value: BulkaccProduct[]; expiresAt: number };
let catalogCache: CacheEntry | null = null;

export function clearBulkaccCache(): void {
  catalogCache = null;
}

/** One page of the product list. */
export async function listProducts(pageIndex = 1, pageSize = CATALOG_PAGE_SIZE): Promise<BulkaccProductPage> {
  const { envelope } = await request("/api/products/list", { pageIndex, pageSize });
  const data = readData(envelope, "/api/products/list") as Record<string, unknown> | null;
  const rawItems = Array.isArray(data?.items) ? data.items : [];
  const items: BulkaccProduct[] = [];
  for (const raw of rawItems) {
    // One malformed row must not take down the whole catalog.
    try {
      items.push(normalizeProduct(raw));
    } catch (error) {
      logger.warn("Skipping a malformed supplier product", {
        code: error instanceof BulkaccError ? error.code : "bad_product",
      });
    }
  }
  return {
    items,
    totalCount: toPositiveIntOrNull(data?.totalCount) ?? items.length,
    pageIndex: toPositiveIntOrNull(data?.pageIndex) ?? pageIndex,
    pageSize: toPositiveIntOrNull(data?.pageSize) ?? pageSize,
    totalPages: toPositiveIntOrNull(data?.totalPages) ?? 1,
  };
}

/**
 * The whole catalog, cached for 30 minutes.
 *
 * Walking pages once and filtering locally is what makes search, grouping and
 * pagination affordable: the supplier's list endpoint is the only catalog call,
 * and stock/price are re-verified per product at checkout.
 */
export async function listAllProducts(): Promise<BulkaccProduct[]> {
  if (catalogCache && Date.now() < catalogCache.expiresAt) return catalogCache.value;

  const products: BulkaccProduct[] = [];
  const seen = new Set<string>();
  let page = 1;
  let totalPages = 1;

  do {
    const result = await listProducts(page);
    totalPages = Math.max(1, Math.min(result.totalPages, MAX_CATALOG_PAGES));
    for (const product of result.items) {
      if (seen.has(product.code)) continue;
      seen.add(product.code);
      products.push(product);
    }
    page += 1;
  } while (page <= totalPages && page <= MAX_CATALOG_PAGES);

  catalogCache = { value: products, expiresAt: Date.now() + CATALOG_TTL_MS };
  return products;
}

/** Authoritative price, stock and minimum for one product. Used at checkout. */
export async function getProduct(productCode: string): Promise<BulkaccProduct> {
  if (!/^[A-Za-z0-9_-]{1,20}$/.test(productCode)) {
    throw new BulkaccError("Invalid product", "bad_product", 400);
  }
  const { envelope, text } = await request("/api/products", { productCode });
  const data = readData(envelope, "/api/products");
  if (!data || typeof data !== "object") {
    // 404 arrives as `{ statusCode: 404, message: "product ... does not exist or stop selling!" }`.
    const salvaged = salvageOrderCode(text);
    if (!salvaged) throw new BulkaccError("Product is no longer available", "product_not_found", 404);
  }
  return normalizeProduct(data);
}

/** Prepaid balance in micro-USD. */
export async function getBalanceMicros(): Promise<number> {
  const { envelope } = await request("/api/accounts", {});
  const data = readData(envelope, "/api/accounts");
  if (typeof data !== "number" && typeof data !== "string") {
    throw new BulkaccError("Supplier balance is unusable", "bad_response", 502);
  }
  return usdMicros(data);
}

/**
 * Refuse to place an order we already know the balance cannot cover.
 *
 * The supplier's own insufficient-balance failure is indistinguishable from
 * success by status code, and by the time it arrives the customer's wallet has
 * been debited and the order needs manual review. Checking first avoids most of
 * those. A balance read failure must not block a purchase, so it fails open and
 * only logs.
 */
export async function ensureSufficientBalance(costMicros: number): Promise<boolean> {
  try {
    const balance = await getBalanceMicros();
    if (balance < costMicros) {
      logger.warn("Supplier balance is too low for this order", { key: maskedKey() });
      return false;
    }
    return true;
  } catch (error) {
    logger.warn("Supplier balance could not be checked", {
      code: error instanceof BulkaccError ? error.code : "unknown_error",
    });
    return true;
  }
}

export type BulkaccOrder = {
  /** Supplier order code. Store it: it is the only handle on the accounts. */
  orderCode: string;
};

/**
 * Create an order. Spends real prepaid balance.
 *
 * No idempotency key exists, so the caller must guarantee this is invoked at
 * most once per customer request (the purchase route reserves the order in the
 * database before calling). Any uncertain result throws with a code for which
 * `isAmbiguousOutcome()` is true, and must be held for reconciliation.
 */
export async function createOrder(productCode: string, quantity: number): Promise<BulkaccOrder> {
  if (!/^[A-Za-z0-9_-]{1,20}$/.test(productCode)) {
    throw new BulkaccError("Invalid product", "bad_product", 400);
  }
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 1000) {
    throw new BulkaccError("Invalid quantity", "bad_quantity", 400);
  }

  const { envelope, text } = await request(
    "/api/orders",
    { productCode, quantity },
    { method: "POST" },
  );

  if (envelope) {
    const data = envelope.data;
    const orderCode = typeof data === "string" ? data.trim()
      : typeof data === "number" && Number.isSafeInteger(data) ? String(data)
      : "";
    if (orderCode) return { orderCode };

    // `data: null` with statusCode 200 is the documented failure shape.
    const message = typeof envelope.message === "string" ? envelope.message.trim() : "";
    const insufficient = /insufficient/i.test(message);
    logger.warn("Supplier refused the order", {
      path: "/api/orders",
      code: insufficient ? "insufficient_supplier_balance" : "rejected",
    });
    throw new BulkaccError(
      insufficient ? "Marketplace stock is temporarily unavailable" : "Marketplace refused the order",
      insufficient ? "insufficient_supplier_balance" : "rejected",
      502,
    );
  }

  // Unparseable body on a money-spending POST: the order may exist. Recover the
  // code if it is in the text; otherwise report an ambiguous outcome so the
  // order is held for review instead of retried.
  const salvaged = salvageOrderCode(text);
  if (salvaged) {
    logger.warn("Recovered an order code from a malformed supplier response", { path: "/api/orders" });
    return { orderCode: salvaged };
  }
  logger.error("Supplier order outcome is unknown", { path: "/api/orders", key: maskedKey() });
  throw new BulkaccError("Marketplace outcome is unknown", "ambiguous_outcome", 502);
}

/**
 * Fetch delivered credentials for an order code.
 *
 * Returns the raw `accountInformation` strings. They are credentials: never log
 * them, and only ever hand them to the authenticated purchaser.
 */
export async function getOrderAccounts(orderCode: string): Promise<string[]> {
  if (!/^[A-Za-z0-9_-]{6,40}$/.test(orderCode)) {
    throw new BulkaccError("Invalid order reference", "bad_order_code", 400);
  }
  const { envelope } = await request("/api/orders", { orderCode });
  const data = readData(envelope, "/api/orders");
  if (!Array.isArray(data)) {
    throw new BulkaccError("Supplier order was not found", "order_not_found", 404);
  }
  const accounts: string[] = [];
  for (const row of data) {
    if (!row || typeof row !== "object") continue;
    const info = (row as Record<string, unknown>).accountInformation;
    if (typeof info === "string" && info.trim()) accounts.push(info.trim().slice(0, 2000));
  }
  return accounts;
}

/** Canonical six-decimal price string, for the shared pricing engine. */
export function productPriceUsd(product: BulkaccProduct): string {
  return usdStringFromMicros(product.priceMicros);
}
