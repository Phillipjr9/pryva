/**
 * SMM panel client for social boosting (followers, likes, views, subscribers).
 *
 * Deliberately panel-agnostic. Essentially every reseller panel implements the
 * same "API v2" contract: one form-encoded POST endpoint driven by `key` plus
 * an `action`, so a single client works with whichever provider is configured
 * and the catalog is read from the panel at runtime rather than hardcoded.
 *   • services — service id, name, category, rate per 1000, min/max, and
 *                refill / cancel / dripfeed capability flags
 *   • balance  — remaining panel balance and its currency
 *   • add      — place an order for a service, target link and quantity
 *   • status   — charge, start_count, remains, status and currency
 *   • refill   — request a refill on an eligible order
 *
 * Two traps shape this client, and both cost money if missed:
 *   1. Rejections arrive as **HTTP 200** carrying an `error` field, so the
 *      status code proves nothing and every body must be inspected. This is the
 *      same failure mode as bulkacc's `{data: null, statusCode: 200}`.
 *   2. There is **no idempotency key on `add`**. Nothing here retries, and a
 *      caller must not either: a second call is a second order and a second
 *      charge against the panel balance. On uncertainty, read `status` back.
 *
 * Billing currency is read from responses and never assumed. Panels bill either
 * USD or NGN and the two imply different retail pricing, so no conversion is
 * attempted here.
 *
 * The API key travels in the request body, never the URL, so the endpoint is
 * safe to log and the body never is. Upstream error text is not surfaced: it can
 * echo the key, the balance or account details.
 */

import "server-only";
import { createRateLimiter } from "@/lib/rate-limit";
import { readJsonWithLimit } from "@/lib/request-body";

const REQUEST_TIMEOUT_MS = 20_000;
const MAX_CATALOG_ENTRIES = 5_000;
// Panels throttle sustained polling. Order status is expected to be read about
// once a minute per order, so a shared 30-per-minute budget covers catalog
// refreshes and status polling without inviting a block.
const panelBudget = createRateLimiter({ windowMs: 60_000, maxRequests: 30 });

export class SmmPanelError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "SmmPanelError";
  }
}

/* ------------------------------------------------------------------ */
/* Configuration                                                        */
/* ------------------------------------------------------------------ */

export function smmPanelApiKey(): string | null {
  const key = process.env.SMM_PANEL_API_KEY?.trim();
  return key ? key : null;
}

export function smmPanelApiUrlSetting(): string | null {
  const url = process.env.SMM_PANEL_API_URL?.trim();
  return url ? url : null;
}

/** Both are required: a key with no endpoint has nowhere to be sent. */
export function isSmmPanelConfigured(): boolean {
  return smmPanelApiKey() !== null && smmPanelApiUrlSetting() !== null;
}

/**
 * Hosts an outbound server-side request must never reach, even when the URL
 * comes from configuration rather than from a customer.
 */
function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host) return true;
  if (host === "localhost" || host.endsWith(".localhost") || host === "ip6-localhost" ||
      host === "metadata.google.internal" || host === "::1") return true;
  if (host.startsWith("169.254.") || host.startsWith("fd") || host.startsWith("fc")) return true;
  const octets = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (octets) {
    const parts = octets.slice(1).map(Number);
    if (parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
    const [a, b] = parts;
    // Loopback, private, link-local, and this-network ranges.
    if (a === 0 || a === 10 || a === 127 || a === 169 && b === 254) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
  }
  return false;
}

/** Validates the configured endpoint once per request and fails closed. */
export function panelEndpoint(): string {
  const raw = smmPanelApiUrlSetting();
  if (!raw) throw new SmmPanelError("SMM_PANEL_API_URL is not configured", 503, "NO_API_URL");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SmmPanelError("Invalid panel configuration", 503, "INVALID_API_URL");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || isBlockedHost(url.hostname)) {
    throw new SmmPanelError("Invalid panel configuration", 503, "INVALID_API_URL");
  }
  return url.origin + url.pathname.replace(/\/+$/, "");
}

/* ------------------------------------------------------------------ */
/* Tolerant extraction helpers                                          */
/* Panels return numbers as strings ("26.88", "100") and capabilities as */
/* either booleans or "true"/"1", so every field is read defensively.    */
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

function pickBoolean(source: unknown, keys: string[]): boolean {
  const record = asRecord(source);
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "boolean") return value;
    if (typeof value === "number" && Number.isFinite(value)) return value !== 0;
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (["true", "1", "yes"].includes(normalized)) return true;
      if (["false", "0", "no"].includes(normalized)) return false;
    }
  }
  return false;
}

/** ISO-4217-shaped currency only; anything else is treated as unreported. */
function currencyCode(value: string | null): string | null {
  if (!value) return null;
  const code = value.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : null;
}

function nonNegative(value: number | null): number | null {
  return value !== null && value >= 0 ? value : null;
}

function positiveInteger(value: number | null): number | null {
  return value !== null && Number.isSafeInteger(value) && value > 0 ? value : null;
}

/** Panels wrap the catalog inconsistently: a bare array, or an object. */
function rowsFrom(payload: unknown, keys: string[]): UnknownRecord[] {
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

async function panelRequest(action: string, params: Record<string, string | number> = {}): Promise<unknown> {
  const key = smmPanelApiKey();
  if (!key) throw new SmmPanelError("SMM_PANEL_API_KEY is not configured", 503, "NO_API_KEY");
  const endpoint = panelEndpoint();

  const budget = await panelBudget("smm-panel:shared-key-budget");
  if (budget.unavailable) throw new SmmPanelError("Panel rate limit is unavailable", 503, "RATE_LIMIT_UNAVAILABLE");
  if (!budget.allowed) throw new SmmPanelError("Panel rate limit reached", 429, "RATE_LIMITED");

  const body = new URLSearchParams({ key, action });
  for (const [name, value] of Object.entries(params)) body.set(name, String(value));

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      // A redirect could silently move the key to another host.
      redirect: "error",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (error) {
    const isTimeout = error instanceof Error && error.name === "TimeoutError";
    throw new SmmPanelError(isTimeout ? "The panel took too long to respond" : "Could not reach the panel", 502, "UPSTREAM_UNREACHABLE");
  }

  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new SmmPanelError(
      "Panel request failed",
      response.status === 429 ? 429 : 502,
      response.status === 429 ? "RATE_LIMITED" : "UPSTREAM_ERROR",
    );
  }

  let payload: unknown;
  try {
    payload = await readJsonWithLimit(response, 4_194_304);
  } catch {
    throw new SmmPanelError("Invalid panel response", 502, "INVALID_RESPONSE");
  }

  // Trap 1: a rejection is HTTP 200 with an `error` field. Check it before
  // reading any result, and never propagate the upstream text.
  if (!Array.isArray(payload)) {
    const record = asRecord(payload);
    if ("error" in record || "err" in record) {
      throw new SmmPanelError("The panel rejected the request", 502, "PANEL_REJECTED");
    }
  }
  if (payload === null || typeof payload !== "object") {
    throw new SmmPanelError("Invalid panel response", 502, "INVALID_RESPONSE");
  }
  return payload;
}

/* ------------------------------------------------------------------ */
/* Catalog and balance                                                  */
/* ------------------------------------------------------------------ */

export type SmmService = {
  /** The panel's own service identifier. Opaque; never shown to a customer. */
  id: string;
  name: string | null;
  category: string | null;
  type: string | null;
  /** Wholesale rate per 1000 units in the panel's billing currency. */
  ratePer1000: number | null;
  currency: string | null;
  min: number | null;
  max: number | null;
  refill: boolean;
  cancel: boolean;
  dripfeed: boolean;
};

export async function listSmmServices(): Promise<SmmService[]> {
  const payload = await panelRequest("services");
  const services: SmmService[] = [];
  const seen = new Set<string>();
  for (const row of rowsFrom(payload, ["services", "data", "items", "list"]).slice(0, MAX_CATALOG_ENTRIES)) {
    const id = pickString(row, ["service", "id", "service_id"]);
    // Without a stable identifier the service cannot be ordered, so it is dropped.
    if (!id || id.length > 40 || seen.has(id)) continue;
    seen.add(id);
    services.push({
      id,
      name: pickString(row, ["name", "title"]),
      category: pickString(row, ["category", "cat", "group"]),
      type: pickString(row, ["type", "service_type"]),
      ratePer1000: nonNegative(pickNumber(row, ["rate", "price", "rate_per_1000", "cost"])),
      currency: currencyCode(pickString(row, ["currency"])),
      min: positiveInteger(pickNumber(row, ["min"])),
      max: positiveInteger(pickNumber(row, ["max"])),
      refill: pickBoolean(row, ["refill", "refillable", "has_refill"]),
      cancel: pickBoolean(row, ["cancel", "cancellable", "has_cancel"]),
      dripfeed: pickBoolean(row, ["dripfeed", "drip_feed", "drip"]),
    });
  }
  return services;
}

export type SmmBalance = { balance: number | null; currency: string | null };

export async function getSmmBalance(): Promise<SmmBalance> {
  const payload = await panelRequest("balance");
  return {
    balance: nonNegative(pickNumber(payload, ["balance", "funds", "amount"])),
    currency: currencyCode(pickString(payload, ["currency"])),
  };
}

/* ------------------------------------------------------------------ */
/* Ordering                                                             */
/* ------------------------------------------------------------------ */

/**
 * The target link is customer-supplied and is forwarded to the panel, so it is
 * validated rather than passed through: bounded length, https only, no embedded
 * credentials and never an internal host. Panels document a 500-character limit.
 */
export function normalizeTargetLink(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw || raw.length > 500) return null;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || isBlockedHost(url.hostname)) return null;
  if (!url.hostname.includes(".")) return null;
  return url.toString();
}

export type SmmOrderPlacement = { orderId: string };

/**
 * Places an order and returns the panel's order reference.
 *
 * Never retry this. The contract has no idempotency key, so a second call is a
 * second order and a second charge; on any uncertainty read the status back.
 */
export async function addSmmOrder(params: { service: string; link: string; quantity: number }): Promise<SmmOrderPlacement> {
  const service = params.service.trim();
  if (!service || service.length > 40) throw new SmmPanelError("Invalid service selection", 400, "INVALID_SERVICE");
  if (!Number.isSafeInteger(params.quantity) || params.quantity <= 0 || params.quantity > 100_000_000) {
    throw new SmmPanelError("Invalid quantity", 400, "INVALID_QUANTITY");
  }
  const link = normalizeTargetLink(params.link);
  if (!link) throw new SmmPanelError("Invalid target link", 400, "INVALID_LINK");

  const payload = await panelRequest("add", { service, link, quantity: params.quantity });
  const orderId = pickString(payload, ["order", "order_id", "orderId", "id"]);
  if (!orderId || orderId.length > 60) {
    // The order may still have been placed. Do not retry: reconcile by status.
    throw new SmmPanelError("The panel did not return an order reference", 502, "NO_ORDER_ID");
  }
  return { orderId };
}

export type SmmOrderState = "pending" | "in_progress" | "completed" | "partial" | "canceled" | "unknown";

export type SmmOrderStatus = {
  orderId: string;
  status: SmmOrderState;
  /** Undelivered units when the panel reports them. Required to auto-refund. */
  remains: number | null;
  startCount: number | null;
  charge: number | null;
  currency: string | null;
};

/** Panels capitalize and spell these inconsistently ("Canceled"/"Cancelled"). */
function orderState(value: string | null): SmmOrderState {
  const normalized = (value ?? "").trim().toLowerCase().replace(/[\s_-]+/g, " ");
  if (!normalized) return "unknown";
  if (["completed", "complete", "finished", "delivered"].includes(normalized)) return "completed";
  if (normalized.startsWith("partial")) return "partial";
  if (["canceled", "cancelled", "refunded", "rejected", "void"].includes(normalized)) return "canceled";
  if (["pending", "queued", "awaiting"].includes(normalized)) return "pending";
  if (["in progress", "processing", "started", "inprogress", "running"].includes(normalized)) return "in_progress";
  return "unknown";
}

export async function getSmmOrderStatus(orderId: string): Promise<SmmOrderStatus> {
  const id = orderId.trim();
  if (!id || id.length > 60) throw new SmmPanelError("Invalid order reference", 400, "INVALID_ORDER");
  const payload = await panelRequest("status", { order: id });
  return {
    orderId: id,
    status: orderState(pickString(payload, ["status", "state", "order_status"])),
    remains: nonNegative(pickNumber(payload, ["remains", "remaining", "remained"])),
    startCount: nonNegative(pickNumber(payload, ["start_count", "startCount", "start"])),
    charge: nonNegative(pickNumber(payload, ["charge", "cost", "price"])),
    currency: currencyCode(pickString(payload, ["currency"])),
  };
}

export type SmmRefill = { refillId: string | null; status: SmmOrderState };

/** Requests a refill. Only services reporting `refill: true` are eligible. */
export async function requestSmmRefill(orderId: string): Promise<SmmRefill> {
  const id = orderId.trim();
  if (!id || id.length > 60) throw new SmmPanelError("Invalid order reference", 400, "INVALID_ORDER");
  const payload = await panelRequest("refill", { order: id });
  const refillId = pickString(payload, ["refill", "refill_id", "refillId"]);
  return {
    refillId: refillId && refillId.length <= 60 ? refillId : null,
    status: orderState(pickString(payload, ["status", "state"])),
  };
}
