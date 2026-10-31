import "server-only";
import { createRateLimiter, resetRateLimit } from "@/lib/rate-limit";
import { readJsonWithLimit } from "@/lib/request-body";

const DEFAULT_BASE_URL = "https://public-api.foxreload.com";
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_BODY_BYTES = 2 * 1024 * 1024;

/**
 * Edge budget: FoxReload documents 5 requests/sec per IP, bursting to 20.
 * A sliding window rate limiter prevents 429 rejections before outbound calls fire.
 */
const foxreloadBudget = createRateLimiter({ windowMs: 10_000, maxRequests: 50 });

export async function resetFoxreloadRateBudget(): Promise<void> {
  await resetRateLimit("foxreload:edge");
}

export class FoxreloadError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "FoxreloadError";
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

  const budget = await foxreloadBudget("foxreload:edge");
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
  isMock?: boolean;
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
  };

  if (params.idempotencyKey) body.idempotencyKey = params.idempotencyKey;
  if (params.isMock !== undefined) body.isMock = params.isMock;
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
