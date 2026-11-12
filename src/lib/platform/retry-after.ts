/** Retry-After may be seconds or an HTTP date. Invalid values are not a cooldown. */
export function retryAfterDelayMs(value: string | null, now = Date.now()): number | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
    const milliseconds = Number(trimmed) * 1000;
    return Number.isFinite(milliseconds) ? milliseconds : null;
  }
  // Date.parse also accepts strings such as "-1" or "1.2.3" as dates. Those
  // are not HTTP dates and must not turn an invalid throttle into a fast retry.
  const imf = /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/;
  const obsolete = /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), \d{2}-(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-\d{2} \d{2}:\d{2}:\d{2} GMT$/;
  const asctime = /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (?: \d|\d{2}) \d{2}:\d{2}:\d{2} \d{4}$/;
  if (!imf.test(trimmed) && !obsolete.test(trimmed) && !asctime.test(trimmed)) return null;
  // The obsolete asctime format has no explicit zone, but HTTP dates are GMT.
  const date = Date.parse(asctime.test(trimmed) ? `${trimmed} GMT` : trimmed);
  return Number.isFinite(date) ? Math.max(0, date - now) : null;
}

/** Convert a response cooldown to an absolute browser deadline. */
export function retryAfterDeadline(value: string | null, fallbackMs = 0, now = Date.now()): number {
  const delay = retryAfterDelayMs(value, now) ?? fallbackMs;
  return delay > 0 ? Math.min(Number.MAX_SAFE_INTEGER, now + delay) : 0;
}

/** Seconds remaining in a shared rate-limit window, rounded up. */
export function retryAfterReset(resetTime: number, now = Date.now()): string {
  return Number.isFinite(resetTime)
    ? String(Math.max(1, Math.ceil((resetTime - now) / 1000)))
    : "60";
}
