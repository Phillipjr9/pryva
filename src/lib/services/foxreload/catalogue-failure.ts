import "server-only";
import { logger } from "@/lib/platform/logger";
import { ProviderError } from "@/lib/providers/types";

/** Neutral responses, with bounded diagnostics that never include supplier text or credentials. */
export function digitalCatalogueFailure(error: unknown, message: string): Response {
  const provider = error instanceof ProviderError && error.provider === "foxreload" ? error : null;
  const reason = !provider ? "unknown"
    : provider.status === 429 ? "throttled"
    : provider.status === 401 || provider.status === 403 ? "authentication"
    : provider.code === "RATE_LIMIT_UNAVAILABLE" ? "rate_limit_store"
    : provider.code === "TIMEOUT" ? "timeout"
    : provider.code === "NETWORK_ERROR" ? "network"
    : provider.code === "INVALID_RESPONSE" ? "invalid_response"
    : "provider_error";
  logger.warn("Digital catalogue read failed", { reason, status: provider?.status ?? null });

  // A rejected supplier credential or invalid supplier configuration will not
  // be repaired by repeated shopper requests. Do not expose its details.
  if (provider && (provider.status === 401 || provider.status === 403 || provider.code === "NO_API_KEY" || provider.code === "INVALID_BASE_URL")) {
    return Response.json({ error: "This catalogue is not connected right now.", code: "unconfigured" }, {
      status: 503, headers: { "Cache-Control": "private, no-store", "Retry-After": "60" },
    });
  }
  if (provider?.status === 429) {
    const seconds = "retryAfterSeconds" in provider ? provider.retryAfterSeconds : undefined;
    const retryAfter = typeof seconds === "number" && Number.isSafeInteger(seconds) && seconds > 0 ? seconds : 60;
    return Response.json({ error: "The catalogue is busy. Please wait and try again." }, {
      status: 429, headers: { "Cache-Control": "private, no-store", "Retry-After": String(retryAfter) },
    });
  }
  return Response.json({ error: message }, {
    status: 503, headers: { "Cache-Control": "private, no-store", "Retry-After": "10" },
  });
}
