import { retryAfterDelayMs } from "@/lib/platform/retry-after";

/** The account and data routes may wait for another instance's cold refresh. */
export const SHARED_CATALOGUE_TIMEOUT_MS = 65_000;
const DEFAULT_CATALOGUE_TIMEOUT_MS = 35_000;
const MAX_ATTEMPTS = 3;

type CatalogueOptions = { timeoutMs?: number; maxAttempts?: number };
export type CatalogueFailureReason = "environment" | "unconfigured" | "sign-in" | "throttled" | "error";

/** Distinguish known non-retryable states without trusting arbitrary error text. */
export function catalogueFailureReason(status: number, code: unknown): CatalogueFailureReason {
  if (status === 401) return "sign-in";
  if (status === 429) return "throttled";
  if (status === 503 && (code === "environment" || code === "unconfigured")) return code;
  return "error";
}

/** Read-only catalogue requests only. Never use this for purchases or mutations. */
export async function fetchCatalogue(url: string, signal?: AbortSignal, options: CatalogueOptions = {}): Promise<Response> {
  const requestedTimeout = options.timeoutMs;
  const requestedAttempts = options.maxAttempts;
  const timeoutMs = typeof requestedTimeout === "number" && Number.isFinite(requestedTimeout) && requestedTimeout > 0
    ? Math.min(Math.ceil(requestedTimeout), SHARED_CATALOGUE_TIMEOUT_MS) : DEFAULT_CATALOGUE_TIMEOUT_MS;
  const maxAttempts = typeof requestedAttempts === "number" && Number.isSafeInteger(requestedAttempts) && requestedAttempts > 0
    ? Math.min(requestedAttempts, MAX_ATTEMPTS) : MAX_ATTEMPTS;
  const deadline = AbortSignal.timeout(timeoutMs);
  const requestSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
  for (let attempt = 0; ; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, { cache: "no-store", signal: requestSignal, redirect: "error" });
    } catch (error) {
      if (requestSignal.aborted || attempt + 1 >= maxAttempts) throw error;
      await pause(500 * 2 ** attempt, requestSignal);
      continue;
    }
    // Authentication failures are not supplier outages and must not be retried.
    if (![429, 502, 503, 504].includes(response.status) || attempt + 1 >= maxAttempts) return response;
    const retryAfter = retryAfterDelayMs(response.headers?.get("retry-after") ?? null);
    // A 429 with no usable cooldown is not permission to hammer the server.
    // Long cooldowns are left to the shopper rather than holding the request open.
    if ((response.status === 429 && retryAfter === null) || (retryAfter !== null && retryAfter > 5_000)) return response;
    // Failure to dispose of a response body must not bypass its cooldown.
    await response.body?.cancel().catch(() => undefined);
    await pause(Math.max(retryAfter ?? 0, 500 * 2 ** attempt), requestSignal);
  }
}

function pause(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException("Aborted", "AbortError")); return; }
    const abort = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); reject(new DOMException("Aborted", "AbortError")); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, ms);
    signal?.addEventListener("abort", abort, { once: true });
  });
}

/** Process every shelf/page without a supplier request stampede. No slicing. */
export async function cataloguePool<T>(items: readonly T[], work: (item: T) => Promise<void>, signal: AbortSignal, concurrency = 3): Promise<void> {
  let index = 0;
  const worker = async () => {
    while (!signal.aborted && index < items.length) {
      const item = items[index++];
      await work(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(items.length, Math.max(1, concurrency)) }, worker));
}
