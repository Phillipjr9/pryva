import "server-only";

/**
 * One place where a production error becomes something a human sees.
 *
 * The app logs well and reports nowhere: `logger.error` writes a structured line
 * to the platform's stdout, and unless somebody is reading the log at that moment
 * a failed payout, a broken cron step or a throwing route is invisible until a
 * customer writes in. This posts those lines to a webhook instead -- Slack and
 * Discord both accept `{ "text": ... }`, so no vendor SDK or account is required
 * to start catching them.
 *
 * Three rules, because an alerting path that can hurt the caller is worse than no
 * alerting at all:
 *
 *  • never throw, never reject -- callers are already handling an error;
 *  • never retry -- a retry storm is how a small outage becomes a large one;
 *  • never send a secret -- contexts are redacted before they leave the process.
 */

/** Keys whose values never leave the process, whatever the caller logged. */
const SECRET_KEY = /pass(word)?|secret|token|authoriz|api[-_]?key|cookie|account[-_]?number|card|otp|activation|iccid|bvn|nin/i;

/** One alert per identical message per window: a failing loop must not flood. */
const THROTTLE_MS = 5 * 60 * 1000;
const MAX_CONTEXT_LENGTH = 1_200;
const TIMEOUT_MS = 3_000;

const lastSent = new Map<string, number>();

export function alertsConfigured(): boolean {
  return Boolean(process.env.ALERT_WEBHOOK_URL?.trim());
}

/** Test seam: the throttle map is module state. */
export function resetAlertThrottle(): void {
  lastSent.clear();
}

export function redactContext(context: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!context) return undefined;
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(context)) {
    if (SECRET_KEY.test(key)) {
      safe[key] = "[redacted]";
      continue;
    }
    if (value && typeof value === "object" && !(value instanceof Date)) {
      safe[key] = redactContext(value as Record<string, unknown>);
      continue;
    }
    if (typeof value === "string" && value.length > 500) {
      safe[key] = `${value.slice(0, 500)}…`;
      continue;
    }
    safe[key] = value instanceof Date ? value.toISOString() : value;
  }
  return safe;
}

export function alertText(message: string, context?: Record<string, unknown>): string {
  const safe = redactContext(context);
  const rendered = safe && Object.keys(safe).length > 0 ? JSON.stringify(safe).slice(0, MAX_CONTEXT_LENGTH) : "";
  return `🚨 Pryva: ${message}${rendered ? `\n${rendered}` : ""}`;
}

/**
 * Post an error to the webhook, if one is configured.
 *
 * Returns whether a request was actually made, which is what tests assert and what
 * an operator can check from a shell: "configured but silent" is a state worth
 * being able to tell apart from "not configured".
 */
export async function sendAlert(message: string, context?: Record<string, unknown>): Promise<boolean> {
  const url = process.env.ALERT_WEBHOOK_URL?.trim();
  if (!url) return false;

  const now = Date.now();
  const previous = lastSent.get(message);
  if (previous !== undefined && now - previous < THROTTLE_MS) return false;
  lastSent.set(message, now);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: alertText(message, context) }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    // An alert channel that throws inside an error handler hides the original
    // failure. Swallow it; console.error already has the line.
    return false;
  }
}
