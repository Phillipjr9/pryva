import { isIP } from "node:net";
import { createRateLimiter, resetRateLimit } from "@/lib/rate-limit";

/**
 * Login and signup throttling (the preview demo has its own IP limiter).
 *
 * Two buckets per request, because they stop different attacks:
 *  - an IP bucket, so one host can't spray thousands of emails at us
 *    (credential stuffing, account enumeration);
 *  - a key bucket, so a botnet spread across IPs still can't grind a single
 *    account's password.
 *
 * Persistent deployments use shared PostgreSQL counters; preview counters are
 * process-local. The trusted edge must overwrite forwarded client-IP headers.
 */

const ipLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, maxRequests: 30 });
const keyLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, maxRequests: 5 });
const signupIpLimiter = createRateLimiter({ windowMs: 60 * 60 * 1000, maxRequests: 10 });

/** Best-effort client IP. Behind a proxy these headers are set by the edge. */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    return first && isIP(first) ? first : "unknown";
  }
  const fallback = request.headers.get("x-real-ip")?.trim() || request.headers.get("cf-connecting-ip")?.trim();
  return fallback && isIP(fallback) ? fallback : "unknown";
}

function tooMany(retryAfterSeconds: number, message: string) {
  return Response.json(
    { ok: false, error: message },
    { status: 429, headers: { "Retry-After": String(Math.max(1, retryAfterSeconds)) } },
  );
}

function unavailable() {
  return Response.json({ ok: false, error: "Sign-in is temporarily unavailable. Please try again later." }, { status: 503 });
}

function secondsUntil(resetTime: number) {
  return Math.ceil((resetTime - Date.now()) / 1000);
}

/**
 * Returns a 429 Response when the caller should be throttled, otherwise null.
 * `identifier` is normally the email address being attempted.
 */
export async function checkAuthRateLimit(
  request: Request,
  scope: "login" | "signup",
  identifier = "",
): Promise<Response | null> {
  const ip = clientIp(request);

  if (scope === "signup") {
    const perIp = await signupIpLimiter(`signup:ip:${ip}`);
    if (perIp.unavailable) return unavailable();
    if (!perIp.allowed) {
      return tooMany(
        secondsUntil(perIp.resetTime),
        "Too many accounts created from this connection. Please try again later.",
      );
    }
    return null;
  }

  const perIp = await ipLimiter(`login:ip:${ip}`);
  if (perIp.unavailable) return unavailable();
  if (!perIp.allowed) {
    return tooMany(
      secondsUntil(perIp.resetTime),
      "Too many sign-in attempts. Please wait a few minutes and try again.",
    );
  }

  if (identifier) {
    const perKey = await keyLimiter(`login:key:${identifier}`);
    if (perKey.unavailable) return unavailable();
    if (!perKey.allowed) {
      return tooMany(
        secondsUntil(perKey.resetTime),
        "Too many sign-in attempts for this account. Please wait a few minutes and try again.",
      );
    }
  }

  return null;
}

/** Successful sign-in clears only the account bucket, not the IP spray budget. */
export async function clearAuthRateLimit(_request: Request, identifier = "") {
  if (identifier) await resetRateLimit(`login:key:${identifier}`);
}
