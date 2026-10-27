/**
 * AccsZone marketplace client — SERVER ONLY.
 *
 * Contract: https://accszone.com/api-docs
 * Base URL:  https://accszone.com/api/v1
 * Auth:      X-API-Key header
 *
 * Rules baked in from the docs:
 *  - Money arrives as strings ("5.00"). We never do float arithmetic on them;
 *    `usdCents()` converts to integer cents first.
 *  - Branch on `success` / `error_code`, never on `message` wording.
 *  - Catalogue endpoints are limited to 30 req/min per ACCOUNT (shared across keys).
 *    Categories/subcategories are cached here because they change rarely.
 *  - A purchase must always carry a `client_reference` UUID so a retry returns
 *    the original order instead of buying twice.
 *  - `X-Request-Id` is logged so support can trace a bad call.
 *
 * This module must never be imported into a client component: it reads a secret
 * and leaks the supplier name into any bundle that includes it.
 */

import "server-only";
import { logger } from "@/lib/logger";

const BASE_URL = process.env.ACCSZONE_API_URL || "https://accszone.com/api/v1";
const API_KEY = process.env.ACCSZONE_API_KEY || "";
const DEFAULT_TIMEOUT_MS = 20_000;

export type AccsZoneRef = { id: number; title: string; slug: string };

export type AccsZoneListing = {
  id: number;
  title: string;
  slug: string;
  /** USD as a string, e.g. "0.44" */
  price: string;
  available_stock: number;
  sold: number;
  sort_key: number;
  category: AccsZoneRef | null;
  subcategory: AccsZoneRef | null;
};

export type AccsZonePurchase = {
  order_id: number;
  listing: string;
  quantity: number;
  amount: string;
  discount: string;
  new_balance: string;
  accounts: string[];
  purchased_at: string;
  replayed?: boolean;
};

export type AccsZoneMeta = {
  current_page: number;
  last_page: number;
  per_page: number;
  total: number;
};

/** Error carrying the machine-readable code so callers can map it to a user message. */
export class AccsZoneError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
    public readonly retryAfterSeconds?: number,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = "AccsZoneError";
  }
}

export function isAccsZoneConfigured(): boolean {
  return API_KEY.length > 0;
}

/** Parse a USD string ("0.44") into integer cents (44). */
export function usdCents(value: string | number): number {
  const raw = typeof value === "number" ? value.toFixed(2) : value.trim();
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(raw);
  if (!match) throw new AccsZoneError(`Unparseable money value: ${raw}`, "bad_money_value", 502);
  const [, sign, whole, frac = ""] = match;
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  return sign === "-" ? -cents : cents;
}

type FetchOptions = {
  method?: "GET" | "POST" | "PUT";
  body?: unknown;
  timeoutMs?: number;
};

async function request<T>(path: string, options: FetchOptions = {}): Promise<{ data: T; meta?: AccsZoneMeta }> {
  if (!isAccsZoneConfigured()) {
    throw new AccsZoneError("Marketplace is not configured", "not_configured", 503);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method: options.method ?? "GET",
      headers: {
        "X-API-Key": API_KEY,
        Accept: "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
      cache: "no-store",
    });
  } catch (error) {
    clearTimeout(timeout);
    // A timeout on /purchase is ambiguous — the caller must retry with the same
    // client_reference, never with a fresh one.
    const aborted = error instanceof Error && error.name === "AbortError";
    throw new AccsZoneError(
      aborted ? "Marketplace timed out" : "Marketplace unreachable",
      aborted ? "timeout" : "network_error",
      504,
    );
  } finally {
    clearTimeout(timeout);
  }

  const requestId = response.headers.get("x-request-id") ?? undefined;
  const retryAfterHeader = response.headers.get("retry-after");
  const retryAfterSeconds = retryAfterHeader ? Number(retryAfterHeader) : undefined;

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new AccsZoneError("Marketplace returned a malformed response", "bad_response", response.status, retryAfterSeconds, requestId);
  }

  const envelope = payload as { success?: boolean; data?: unknown; meta?: AccsZoneMeta; error_code?: string; message?: string };

  if (!response.ok || envelope.success === false) {
    const code = envelope.error_code ?? (response.status === 401 || response.status === 403 ? "auth_failed" : "unknown_error");
    logger.warn("Marketplace request failed", {
      path,
      status: response.status,
      code,
      requestId,
      retryAfterSeconds,
    });
    throw new AccsZoneError(
      envelope.message ?? "Marketplace request failed",
      code,
      response.status,
      retryAfterSeconds,
      requestId,
    );
  }

  return { data: envelope.data as T, meta: envelope.meta };
}

/** One page of categories (20 per page, fixed). */
export async function listCategories(page = 1): Promise<{ categories: AccsZoneRef[]; meta: AccsZoneMeta }> {
  const { data, meta } = await request<Array<AccsZoneRef & { image?: string }>>(`/categories?page=${page}`);
  // The provider ships its own branded image URLs — deliberately dropped so the
  // supplier is never exposed to shoppers.
  const categories = (data ?? []).map(({ id, title, slug }) => ({ id, title, slug }));
  return { categories, meta: meta ?? { current_page: page, last_page: page, per_page: 20, total: categories.length } };
}

const CATALOGUE_TTL_MS = 30 * 60 * 1000;
type CacheEntry<T> = { value: T; expiresAt: number };
const cache = new Map<string, CacheEntry<unknown>>();

function readCache<T>(key: string): T | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    cache.delete(key);
    return null;
  }
  return hit.value as T;
}

function writeCache<T>(key: string, value: T): void {
  cache.set(key, { value, expiresAt: Date.now() + CATALOGUE_TTL_MS });
}

/**
 * Every category, walking pages. Cached for 30 minutes — the catalogue rate limit
 * is 30 requests/minute for the whole account, so this matters.
 */
export async function listAllCategories(): Promise<AccsZoneRef[]> {
  const cached = readCache<AccsZoneRef[]>("categories");
  if (cached) return cached;

  const categories: AccsZoneRef[] = [];
  let page = 1;
  let lastPage = 1;

  do {
    const result = await listCategories(page);
    categories.push(...result.categories);
    lastPage = result.meta.last_page;
    page += 1;
  } while (page <= lastPage && page <= 20);

  writeCache("categories", categories);
  return categories;
}

export async function listSubcategories(
  categoryId: number,
  page = 1,
): Promise<{ category: AccsZoneRef | null; subcategories: AccsZoneRef[]; meta: AccsZoneMeta }> {
  const { data, meta } = await request<{ category: AccsZoneRef; subcategories: AccsZoneRef[] }>(
    `/categories/${categoryId}/subcategories?page=${page}`,
  );
  return {
    category: data?.category ?? null,
    subcategories: data?.subcategories ?? [],
    meta: meta ?? { current_page: page, last_page: page, per_page: 20, total: data?.subcategories?.length ?? 0 },
  };
}

export async function listAllSubcategories(categoryId: number): Promise<AccsZoneRef[]> {
  const key = `subcategories:${categoryId}`;
  const cached = readCache<AccsZoneRef[]>(key);
  if (cached) return cached;

  const all: AccsZoneRef[] = [];
  let page = 1;
  let lastPage = 1;
  do {
    const result = await listSubcategories(categoryId, page);
    all.push(...result.subcategories);
    lastPage = result.meta.last_page;
    page += 1;
  } while (page <= lastPage && page <= 10);

  writeCache(key, all);
  return all;
}

export type ListingQuery = {
  categoryId?: number;
  subcategoryId?: number;
  search?: string;
  /** sort_key | total_price | available_stock | title */
  sort?: "sort_key" | "total_price" | "available_stock" | "title";
  direction?: "asc" | "desc";
  page?: number;
};

/**
 * Live inventory. Not cached: stock and price move, and `/purchase` is the
 * authority anyway.
 */
export async function listListings(query: ListingQuery = {}): Promise<{ listings: AccsZoneListing[]; meta: AccsZoneMeta }> {
  const params = new URLSearchParams();
  if (query.categoryId) params.set("category_id", String(query.categoryId));
  if (query.subcategoryId) params.set("subcategory_id", String(query.subcategoryId));
  if (query.search) params.set("search", query.search);
  if (query.sort) params.set("sort", query.sort);
  if (query.direction) params.set("direction", query.direction);
  params.set("page", String(query.page ?? 1));

  const { data, meta } = await request<AccsZoneListing[]>(`/listings?${params.toString()}`);
  return {
    listings: data ?? [],
    meta: meta ?? { current_page: query.page ?? 1, last_page: 1, per_page: 20, total: data?.length ?? 0 },
  };
}

export async function getListing(slug: string): Promise<AccsZoneListing & { description?: string }> {
  const { data } = await request<AccsZoneListing & { description?: string }>(`/listings/${encodeURIComponent(slug)}`);
  return data;
}

/**
 * Buy accounts. `clientReference` MUST be a UUID and MUST be reused on every retry
 * of the same intended purchase — that is what makes a timeout safe.
 */
export async function purchaseAccounts(input: {
  listingId: number;
  quantity: number;
  clientReference: string;
  promoCode?: string;
}): Promise<AccsZonePurchase> {
  const { data } = await request<AccsZonePurchase>("/purchase", {
    method: "POST",
    body: {
      ad_id: input.listingId,
      quantity: input.quantity,
      client_reference: input.clientReference,
      ...(input.promoCode ? { promo_code: input.promoCode } : {}),
    },
  });
  return data;
}

export async function getOrder(orderId: number): Promise<AccsZonePurchase & { is_refund: boolean }> {
  const { data } = await request<AccsZonePurchase & { is_refund: boolean }>(`/orders/${orderId}`);
  return data;
}

export async function getBalance(): Promise<string> {
  const { data } = await request<{ balance: string }>("/user/balance");
  return data?.balance ?? "0.00";
}

/** Returns a discount preview. Invalid codes throw with code `promo_invalid`. */
export async function validatePromo(code: string, amount: number): Promise<{ discount: string; final_amount: string }> {
  const { data } = await request<{ valid: boolean; original_amount: string; discount: string; final_amount: string }>(
    "/promo/validate",
    { method: "POST", body: { code, amount } },
  );
  return { discount: data.discount, final_amount: data.final_amount };
}
