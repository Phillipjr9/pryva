import "server-only";
import { createRateLimiter, resetRateLimit } from "@/lib/platform/rate-limit";
import { readJsonWithLimit } from "@/lib/platform/request-body";
import { ProviderError } from "@/lib/providers/types";

const DEFAULT_BASE_URL = "https://public-api.foxreload.com";
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_BODY_BYTES = 2 * 1024 * 1024;

/**
 * Edge budget: FoxReload documents 5 requests/sec per IP, bursting to 20.
 * A sliding window rate limiter prevents 429 rejections before outbound calls fire.
 */
const foxreloadBudget = createRateLimiter({ windowMs: 10_000, maxRequests: 50 });
// Search has a lower documented per-key limit than ordinary catalogue reads.
const foxreloadSearchBudget = createRateLimiter({ windowMs: 60_000, maxRequests: 50 });
const foxreloadCreateBudget = createRateLimiter({ windowMs: 60_000, maxRequests: 25 });
const foxreloadClientCodeBudget = createRateLimiter({ windowMs: 60_000, maxRequests: 25 });

export async function resetFoxreloadRateBudget(): Promise<void> {
  await resetRateLimit("foxreload:edge");
  await resetRateLimit("foxreload:search");
  await resetRateLimit("foxreload:create");
  await resetRateLimit("foxreload:client-code");
}

export class FoxreloadError extends ProviderError {
  readonly details?: unknown;

  constructor(message: string, status: number, code?: string, details?: unknown) {
    super(message, { provider: "foxreload", status, code: code ?? "FOXRELOAD_ERROR" });
    this.name = "FoxreloadError";
    this.details = details;
  }
}

export function foxreloadApiKey(): string | null {
  const key = process.env.FOXRELOAD_API_KEY?.trim();
  return key ? key : null;
}

export function isFoxreloadConfigured(): boolean {
  return foxreloadApiKey() !== null;
}

function baseUrl(): string {
  const value = (process.env.FOXRELOAD_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, "");
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "public-api.foxreload.com" || url.port || url.username || url.password) {
      throw new Error("Invalid URL");
    }
    return url.origin;
  } catch {
    throw new FoxreloadError("Invalid FoxReload provider configuration", 503, "INVALID_BASE_URL");
  }
}

export type FoxreloadAccount = {
  id: string;
  email: string;
  balance: number;
  currency: string;
  tier?: string;
};

export type FoxreloadCategory = {
  id: string;
  name: string;
  slug: string;
  parentId?: string | null;
  iconUrl?: string | null;
};

export type FoxreloadProduct = {
  id: string;
  name: string;
  slug: string;
  categoryId: string;
  price: number;
  currency: string;
  quantity: number;
  deliveryType: "code" | "esim" | "direct_topup" | "login_topup" | string;
  minQuantity?: number;
  maxQuantity?: number;
};

export type FoxreloadOrderItem = {
  id: string;
  itemId: string;
  product?: { id: string; name: string };
  quantity: number;
  status: "pending" | "processing" | "completed" | "failed" | "action_required" | string;
  externalData: string[];
  error?: string | null;
};

export type FoxreloadOrder = {
  id: string;
  status: "pending" | "processing" | "completed" | "failed" | "action_required" | string;
  totalPrice?: number;
  currency?: string;
  items: FoxreloadOrderItem[];
  createdAt: string;
  completedAt?: string | null;
};

async function foxreloadFetch(
  path: string,
  init: {
    method?: "GET" | "POST";
    body?: Record<string, unknown>;
    query?: Record<string, string | number | boolean | undefined>;
    currency?: "usd" | "rub";
  } = {},
): Promise<unknown> {
  const key = foxreloadApiKey();
  if (!key) {
    throw new FoxreloadError("FOXRELOAD_API_KEY is not configured", 503, "NO_API_KEY");
  }

  // Endpoint limits are shared across legacy and contract clients.
  const special = path === "/api/products/search" ? [foxreloadSearchBudget, "foxreload:search"] as const
    : path === "/api/orders/" && init.method === "POST" ? [foxreloadCreateBudget, "foxreload:create"] as const
    : /^\/api\/orders\/[^/]+\/client-code$/.test(path) && init.method === "POST" ? [foxreloadClientCodeBudget, "foxreload:client-code"] as const
    : null;
  if (special) {
    const specific = await special[0](special[1]);
    if (specific.unavailable) throw new FoxreloadError("FoxReload endpoint budget unavailable", 503, "RATE_LIMIT_UNAVAILABLE");
    if (!specific.allowed) throw new FoxreloadError("FoxReload endpoint rate budget exceeded", 429, "RATE_LIMITED");
  }
  const budget = await foxreloadBudget("foxreload:edge");
  if (budget.unavailable) throw new FoxreloadError("FoxReload rate budget unavailable", 503, "RATE_LIMIT_UNAVAILABLE");
  if (!budget.allowed) {
    throw new FoxreloadError("FoxReload rate budget exceeded", 429, "RATE_LIMITED");
  }

  const url = new URL(baseUrl() + path);
  if (init.query) {
    for (const [name, val] of Object.entries(init.query)) {
      if (val !== undefined) url.searchParams.set(name, String(val));
    }
  }

  const headers: Record<string, string> = {
    "X-API-Key": key,
    "X-Language": "en",
    "X-Currency": init.currency ?? "usd",
    Accept: "application/json",
  };

  if (init.body) {
    headers["Content-Type"] = "application/json";
  }

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method: init.method ?? "GET",
      headers,
      body: init.body ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new FoxreloadError("FoxReload request timed out", 504, "TIMEOUT");
    }
    throw new FoxreloadError("FoxReload request failed", 502, "NETWORK_ERROR");
  }

  const payload = (await readJsonWithLimit(response, MAX_BODY_BYTES).catch(() => null)) as Record<string, unknown> | null;

  if (!response.ok) {
    const status = response.status;
    const errObj = (payload?.error && typeof payload.error === "object" ? payload.error : payload) as Record<string, unknown> | null;
    const message = typeof errObj?.message === "string" ? errObj.message : `FoxReload error ${status}`;
    const code = typeof errObj?.code === "string" ? errObj.code : `HTTP_${status}`;
    throw new FoxreloadError(message, status, code, errObj?.details);
  }

  return payload;
}

/** Authenticated, read-only readiness probe. Never return profile fields or balances. */
export async function probeFoxreloadAccount(): Promise<{ active: boolean; funds: { usd: "positive" | "zero" | "unknown"; rub: "positive" | "zero" | "unknown" } }> {
  const profile = await foxreloadFetch("/api/access/me");
  if (!profile || typeof profile !== "object" || Array.isArray(profile) || typeof (profile as Record<string, unknown>).isActive !== "boolean") {
    throw new FoxreloadError("Invalid account response", 502, "INVALID_RESPONSE");
  }
  const raw = await foxreloadFetch("/api/access/me/balances/");
  if (!Array.isArray(raw) || raw.length > 10) throw new FoxreloadError("Invalid balance response", 502, "INVALID_RESPONSE");
  const funds: { usd: "positive" | "zero" | "unknown"; rub: "positive" | "zero" | "unknown" } = { usd: "unknown", rub: "unknown" };
  const seen = new Set<string>();
  for (const entry of raw) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new FoxreloadError("Invalid balance response", 502, "INVALID_RESPONSE");
    const { currency, available } = entry as Record<string, unknown>;
    if (currency !== "usd" && currency !== "rub") continue;
    if (seen.has(currency) || typeof available !== "string" || !/^(?:0|[1-9]\d{0,20})(?:\.\d{1,18})?$/.test(available)) throw new FoxreloadError("Invalid balance response", 502, "INVALID_RESPONSE");
    seen.add(currency);
    funds[currency] = /[1-9]/.test(available) ? "positive" : "zero";
  }
  return { active: (profile as Record<string, boolean>).isActive, funds };
}

export async function getFoxreloadAccount(): Promise<FoxreloadAccount> {
  const data = (await foxreloadFetch("/api/access/me")) as Record<string, unknown>;
  return {
    id: String(data?.id ?? "unknown"),
    email: String(data?.email ?? ""),
    balance: typeof data?.balance === "number" ? data.balance : 0,
    currency: String(data?.currency ?? "usd"),
    tier: typeof data?.tier === "string" ? data.tier : undefined,
  };
}

export async function listFoxreloadCategories(parentId?: string): Promise<FoxreloadCategory[]> {
  const data = (await foxreloadFetch("/api/categories/", {
    query: parentId ? { parent_id_or_slug: parentId } : undefined,
  })) as unknown[];

  if (!Array.isArray(data)) return [];
  return data.map((item: any) => ({
    id: String(item?.id ?? ""),
    name: String(item?.name ?? ""),
    slug: String(item?.slug ?? ""),
    parentId: item?.parentId ? String(item.parentId) : null,
    iconUrl: item?.iconUrl ? String(item.iconUrl) : null,
  }));
}

export async function listFoxreloadProducts(params: {
  categoryIdOrSlug?: string;
  limit?: number;
  includeDescendants?: boolean;
} = {}): Promise<FoxreloadProduct[]> {
  const data = (await foxreloadFetch("/api/products/", {
    query: {
      category_id_or_slug: params.categoryIdOrSlug,
      limit: params.limit ?? 50,
      includeDescendants: params.includeDescendants,
    },
  })) as any;

  const items = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];
  return items.map((item: any) => ({
    id: String(item?.id ?? ""),
    name: String(item?.name ?? ""),
    slug: String(item?.slug ?? ""),
    categoryId: String(item?.categoryId ?? ""),
    price: typeof item?.price === "number" ? item.price : 0,
    currency: String(item?.currency ?? "usd"),
    quantity: typeof item?.quantity === "number" ? item.quantity : 0,
    deliveryType: String(item?.deliveryType ?? "code"),
    minQuantity: typeof item?.minQuantity === "number" ? item.minQuantity : 1,
    maxQuantity: typeof item?.maxQuantity === "number" ? item.maxQuantity : 10,
  }));
}

export async function searchFoxreloadProducts(query: string): Promise<FoxreloadProduct[]> {
  const data = (await foxreloadFetch("/api/products/search", {
    query: { query },
  })) as any;

  const items = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];
  return items.map((item: any) => ({
    id: String(item?.id ?? ""),
    name: String(item?.name ?? ""),
    slug: String(item?.slug ?? ""),
    categoryId: String(item?.categoryId ?? ""),
    price: typeof item?.price === "number" ? item.price : 0,
    currency: String(item?.currency ?? "usd"),
    quantity: typeof item?.quantity === "number" ? item.quantity : 0,
    deliveryType: String(item?.deliveryType ?? "code"),
  }));
}

/**
 * Read-only catalog access. Keep raw data server-side: unlike the legacy
 * checkout mapper this function does not invent a currency or delivery type.
 * Cursor mode walks the complete feed, while search is limited upstream to 50.
 */
/** Root categories only: descendants are browsed through the product cursor. */
export async function readFoxreloadBrowseCategories(): Promise<unknown[]> {
  const value = await foxreloadFetch("/api/categories/tree", { query: { depth: 1 } });
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new FoxreloadError("Invalid category response", 502, "INVALID_RESPONSE");
  const rows = (value as Record<string, unknown>).items;
  if (!Array.isArray(rows) || rows.length > 500) throw new FoxreloadError("Invalid category response", 502, "INVALID_RESPONSE");
  return rows;
}

export async function readFoxreloadBrowsePage(options: { query?: string; cursor?: string; category?: string } = {}): Promise<{ rows: unknown[]; nextCursor: string | null; searchLimited: boolean }> {
  if (options.query) {
    const value = await foxreloadFetch("/api/products/search", { query: { query: options.query, categoryId: options.category, limit: 50 } });
    if (!Array.isArray(value) || value.length > 50) throw new FoxreloadError("Invalid catalog response", 502, "INVALID_RESPONSE");
    return { rows: value, nextCursor: null, searchLimited: value.length === 50 };
  }
  const value = await foxreloadFetch("/api/products/", { query: { includeDescendants: true, categoryId: options.category, limit: 50, cursor: options.cursor } });
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new FoxreloadError("Invalid catalog response", 502, "INVALID_RESPONSE");
  const page = value as Record<string, unknown>;
  if (!Array.isArray(page.items) || page.items.length > 50 || !(page.nextCursor == null || (typeof page.nextCursor === "string" && page.nextCursor.length > 0 && page.nextCursor.length <= 512))) {
    throw new FoxreloadError("Invalid catalog response", 502, "INVALID_RESPONSE");
  }
  if (typeof page.nextCursor === "string" && page.nextCursor === options.cursor) throw new FoxreloadError("Catalog cursor did not advance", 502, "INVALID_RESPONSE");
  return { rows: page.items, nextCursor: (page.nextCursor as string | null | undefined) ?? null, searchLimited: false };
}

export async function getFoxreloadProduct(id: string): Promise<FoxreloadProduct> {
  const item = (await foxreloadFetch(`/api/products/${encodeURIComponent(id)}`)) as any;
  return {
    id: String(item?.id ?? ""),
    name: String(item?.name ?? ""),
    slug: String(item?.slug ?? ""),
    categoryId: String(item?.categoryId ?? ""),
    price: typeof item?.price === "number" ? item.price : 0,
    currency: String(item?.currency ?? "usd"),
    quantity: typeof item?.quantity === "number" ? item.quantity : 0,
    deliveryType: String(item?.deliveryType ?? "code"),
  };
}

export async function createFoxreloadOrder(params: {
  itemId: string;
  quantity?: number;
  note?: Record<string, unknown>;
  totalPrice?: number;
  idempotencyKey?: string;
  contactEmail?: string;
}): Promise<FoxreloadOrder> {
  const item: Record<string, unknown> = {
    itemId: params.itemId,
    quantity: params.quantity ?? 1,
  };
  if (params.note) item.note = params.note;
  if (params.totalPrice !== undefined) item.totalPrice = params.totalPrice.toFixed(2);

  const body: Record<string, unknown> = {
    items: [item],
    isMock: false,
  };

  if (params.idempotencyKey) body.idempotencyKey = params.idempotencyKey;
  if (params.contactEmail) body.contactEmail = params.contactEmail;

  const data = (await foxreloadFetch("/api/orders/", {
    method: "POST",
    body,
  })) as any;

  return parseOrder(data);
}

/**
 * Resolves the FoxReload product ID to use when ordering.
 * If the denomination provides a known FoxReload product ID or UUID/TypeID, uses it.
 * Otherwise queries FoxReload's product catalog/search for the matching denomination.
 */
export async function resolveFoxreloadProductId(params: {
  brand: string;
  amountUsd: number;
  preferredId?: string;
}): Promise<string> {
  const preferred = params.preferredId?.trim();
  if (preferred && /^(product_|offer_|[0-9a-f]{8}-[0-9a-f]{4})/i.test(preferred)) {
    return preferred;
  }

  // Attempt search on live FoxReload catalog
  try {
    const searchResults = await searchFoxreloadProducts(`${params.brand} ${params.amountUsd}`);
    if (searchResults.length > 0) {
      const match = searchResults.find(
        (p) => p.deliveryType === "code" || Math.abs(p.price - params.amountUsd) <= 1.0,
      );
      if (match) return match.id;
      return searchResults[0].id;
    }
  } catch {
    // If catalog search fails, continue with preferred fallback
  }

  return preferred || `${params.brand.toLowerCase()}-${params.amountUsd}-usd`;
}

export async function payFoxreloadOrder(orderId: string): Promise<{ orderId: string; status: string }> {
  const data = (await foxreloadFetch(`/api/orders/${encodeURIComponent(orderId)}/pay`, {
    method: "POST",
  })) as any;

  return {
    orderId: String(data?.id ?? orderId),
    status: String(data?.status ?? "processing"),
  };
}

export async function getFoxreloadOrder(orderId: string): Promise<FoxreloadOrder> {
  const data = (await foxreloadFetch(`/api/orders/${encodeURIComponent(orderId)}`)) as any;
  return parseOrder(data);
}

function parseOrder(data: any): FoxreloadOrder {
  const items: FoxreloadOrderItem[] = Array.isArray(data?.items)
    ? data.items.map((item: any) => ({
        id: String(item?.id ?? ""),
        itemId: String(item?.itemId ?? item?.product?.id ?? ""),
        product: item?.product ? { id: String(item.product.id ?? ""), name: String(item.product.name ?? "") } : undefined,
        quantity: typeof item?.quantity === "number" ? item.quantity : 1,
        status: String(item?.fulfillmentStatus ?? item?.status ?? "pending"),
        externalData: Array.isArray(item?.externalData) ? item.externalData.map(String) : [],
        error: typeof item?.error === "string" ? item.error : null,
      }))
    : [];

  return {
    id: String(data?.id ?? ""),
    status: String(data?.status ?? "pending"),
    totalPrice: typeof data?.totalPrice === "number" ? data.totalPrice : undefined,
    currency: typeof data?.currency === "string" ? data.currency : undefined,
    items,
    createdAt: String(data?.createdAt ?? new Date().toISOString()),
    completedAt: data?.completedAt ? String(data.completedAt) : null,
  };
}

/**
 * Polls for voucher/gift card codes after payment.
 * When FoxReload finishes routing with the supplier, codes appear in `externalData`.
 */
export async function pollFoxreloadOrderCodes(
  orderId: string,
  options: { maxWaitMs?: number; intervalMs?: number } = {},
): Promise<string[]> {
  const maxWait = options.maxWaitMs ?? 25_000;
  const interval = options.intervalMs ?? 2_000;
  const start = Date.now();

  while (Date.now() - start < maxWait) {
    const order = await getFoxreloadOrder(orderId);
    if (order.status === "completed") {
      const codes = order.items.flatMap((item) => item.externalData).filter(Boolean);
      if (codes.length > 0) return codes;
    }
    if (order.status === "failed") {
      const errorMsg = order.items.find((i) => i.error)?.error ?? "Upstream order failed";
      throw new FoxreloadError(errorMsg, 502, "ORDER_FAILED");
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }

  // If order is still processing, return whatever has arrived so far
  const current = await getFoxreloadOrder(orderId);
  return current.items.flatMap((item) => item.externalData).filter(Boolean);
}

/**
 * Strict contract functions for the next-generation integration. These are
 * server-only primitives, NOT customer purchase endpoints. A caller must first
 * commit a wallet claim and reconcile ambiguous create/payment outcomes.
 */
export async function readFoxreloadProductContract(productId: string): Promise<import("@/lib/services/foxreload/contract").Product> {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(productId)) throw new FoxreloadError("Invalid product ID", 400, "INVALID_PRODUCT");
  const { parseProduct } = await import("@/lib/services/foxreload/contract");
  const product = parseProduct(await foxreloadFetch(`/api/products/${encodeURIComponent(productId)}`));
  if (!product || product.id !== productId) throw new FoxreloadError("Invalid product response", 502, "INVALID_RESPONSE");
  return product;
}

/**
 * Exact decimal total, quantity and notes must be produced from a freshly read
 * contract, not accepted from the browser. `mock` must be explicitly chosen.
 * Once called, a timeout is ambiguous even for mock orders; do not retry a live
 * order or refund the customer without independent provider evidence.
 */
export async function createFoxreloadContractOrder(input: {
  product: import("@/lib/services/foxreload/contract").Product;
  quantity: number;
  note: Record<string, import("@/lib/services/foxreload/contract").NoteValue>;
  idempotencyKey: string;
  mock: boolean;
}): Promise<unknown> {
  const { buildOrderItem } = await import("@/lib/services/foxreload/contract");
  const item = buildOrderItem(input.product, input.quantity, input.note);
  if (!item || !/^[A-Za-z0-9_-]{1,64}$/.test(item.itemId) || !/^[A-Za-z0-9_-]{1,128}$/.test(input.idempotencyKey) || typeof input.mock !== "boolean") {
    throw new FoxreloadError("Invalid order input", 400, "INVALID_ORDER");
  }
  return foxreloadFetch("/api/orders/", { method: "POST", body: { items: [item], idempotencyKey: input.idempotencyKey, isMock: input.mock } });
}

/** Login top-ups may require a buyer confirmation code after payment. */
export async function submitFoxreloadClientCode(orderId: string, itemId: string, clientCode: string): Promise<unknown> {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(orderId) || !uuid.test(itemId) || !/^[A-Za-z0-9 ._-]{1,255}$/.test(clientCode)) {
    throw new FoxreloadError("Invalid confirmation input", 400, "INVALID_CLIENT_CODE");
  }
  return foxreloadFetch(`/api/orders/${encodeURIComponent(orderId)}/client-code`, { method: "POST", body: { itemId, clientCode } });
}

/** Raw detail for contract-aware reconciliation. Keep on the server. */
export async function readFoxreloadContractOrder(orderId: string): Promise<unknown> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderId)) {
    throw new FoxreloadError("Invalid order ID", 400, "INVALID_ORDER");
  }
  return foxreloadFetch(`/api/orders/${encodeURIComponent(orderId)}`);
}

/** Find a unique supplier order by our own idempotency key, without retrying
 * creation or payment. A listing is only a hint; callers must verify the full
 * order against the durable quote and intent before linking or delivering. */
export async function findFoxreloadOrderId(idempotencyKey: string): Promise<string | null> {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(idempotencyKey)) throw new FoxreloadError("Invalid order key", 400, "INVALID_ORDER");
  const raw = await foxreloadFetch("/api/orders/", { query: { idempotencyKey, limit: 2, offset: 0 } });
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const page = raw as Record<string, unknown>;
  if (page.total !== 1 || page.offset !== 0 || !Array.isArray(page.items) || page.items.length !== 1) return null;
  const item = page.items[0] as Record<string, unknown> | null;
  return item && typeof item.id === "string" && uuid.test(item.id) && item.idempotencyKey === idempotencyKey ? item.id : null;
}
