/** Read-only catalogue requests only. Never use this for purchases or mutations. */
export async function fetchCatalogue(url: string, signal?: AbortSignal): Promise<Response> {
  const deadline = AbortSignal.timeout(25_000);
  const requestSignal = signal ? AbortSignal.any([signal, deadline]) : deadline;
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(url, { cache: "no-store", signal: requestSignal, redirect: "error" });
      // Authentication failures are not supplier outages and must not be retried.
      if (![429, 502, 503, 504].includes(response.status) || attempt >= 2) return response;
      const retryAfter = response.headers.get("retry-after");
      const parsed = retryAfter ? Number(retryAfter) : NaN;
      // Do not disregard a long supplier cooldown by immediately retrying.
      if (Number.isFinite(parsed) && parsed > 5) return response;
      await response.body?.cancel();
      await pause(Number.isFinite(parsed) && parsed > 0 ? parsed * 1000 : 500 * 2 ** attempt, requestSignal);
    } catch (error) {
      if (requestSignal.aborted || attempt >= 2) throw error;
      await pause(500 * 2 ** attempt, requestSignal);
    }
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
