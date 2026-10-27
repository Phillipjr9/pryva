/**
 * Server-side client for the upstream number/eSIM/proxy provider.
 *
 * Supplier identities never reach the browser: everything user-facing is
 * mapped to neutral text by the callers. Errors carry a machine-readable code so
 * route handlers can decide whether to refund.
 */

const BASE_URL = process.env.FLEEXA_API_URL || "https://api.fleexa.com/v1";
const API_KEY = process.env.FLEEXA_API_KEY || "";
const TIMEOUT_MS = 20_000;

export class FleexaError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 500,
  ) {
    super(message);
    this.name = "FleexaError";
  }
}

export function isFleexaConfigured(): boolean {
  return Boolean(API_KEY);
}

export interface FleexaOrderRequest {
  service: string;
  country: string;
  app?: string;
  emailProduct?: string;
  months?: number;
}

export interface FleexaOrderResponse {
  orderId: string;
  number?: string;
  email?: string;
  proxyEndpoint?: string;
  proxyAuth?: string;
  esimQr?: string;
  esimDetails?: {
    iccid: string;
    activationCode: string;
  };
  status: "pending" | "active" | "failed";
  expiresAt?: string;
}

export interface FleexaSmsResponse {
  messages: Array<{
    from: string;
    body: string;
    receivedAt: string;
  }>;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!API_KEY) {
    throw new FleexaError("NO_API_KEY", "Fulfilment provider is not configured", 503);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      ...init,
      cache: "no-store",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...(init.headers ?? {}),
      },
    });
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    throw new FleexaError(
      aborted ? "TIMEOUT" : "NETWORK_ERROR",
      aborted ? "Provider timed out" : "Could not reach the provider",
      504,
    );
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    const code =
      response.status === 404
        ? "ORDER_NOT_FOUND"
        : response.status === 401 || response.status === 403
          ? "PROVIDER_AUTH"
          : response.status === 429
            ? "RATE_LIMITED"
            : "PROVIDER_ERROR";
    throw new FleexaError(code, `Provider error ${response.status}: ${detail.slice(0, 200)}`, response.status);
  }

  return (await response.json()) as T;
}

export function createFleexaOrder(params: FleexaOrderRequest): Promise<FleexaOrderResponse> {
  return request<FleexaOrderResponse>("/orders", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

export function getFleexaOrderStatus(orderId: string): Promise<FleexaOrderResponse> {
  return request<FleexaOrderResponse>(`/orders/${encodeURIComponent(orderId)}`);
}

export function getFleexaSmsMessages(orderId: string): Promise<FleexaSmsResponse> {
  return request<FleexaSmsResponse>(`/orders/${encodeURIComponent(orderId)}/sms`);
}

export async function getFleexaStatus(): Promise<{
  configured: boolean;
  online: boolean;
  balanceNgn?: number;
}> {
  if (!isFleexaConfigured()) {
    return { configured: false, online: false };
  }

  try {
    const data = await request<{ balance?: number }>("/balance");
    return { configured: true, online: true, balanceNgn: Number(data.balance ?? 0) };
  } catch {
    return { configured: true, online: false };
  }
}

export function cancelFleexaOrder(orderId: string): Promise<void> {
  return request<void>(`/orders/${encodeURIComponent(orderId)}`, { method: "DELETE" });
}

export function extractOtpFromSms(smsBody: string): string | null {
  // Common OTP patterns
  const patterns = [
    /\b(\d{4,6})\b/, // 4-6 digit codes
    /code[:\s]+(\d{4,6})/i, // "code: 123456"
    /otp[:\s]+(\d{4,6})/i, // "otp: 123456"
    /verification[:\s]+(\d{4,6})/i, // "verification: 123456"
  ];

  for (const pattern of patterns) {
    const match = smsBody.match(pattern);
    if (match) {
      return match[1];
    }
  }

  return null;
}

export async function pollForOtp(
  orderId: string,
  maxAttempts: number = 10,
  intervalMs: number = 5000,
): Promise<string | null> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const { messages } = await getFleexaSmsMessages(orderId);

      if (messages.length > 0) {
        const latestMessage = messages[0];
        const otp = extractOtpFromSms(latestMessage.body);

        if (otp) {
          return otp;
        }
      }
    } catch (error) {
      console.error(`SMS polling attempt ${attempt + 1} failed:`, error);
    }

    if (attempt < maxAttempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  return null;
}

/* ------------------------------------------------------------------ *
 * Sync helpers used by /api/orders/[id]/sync
 * ------------------------------------------------------------------ */

/** Latest OTP for a plain SMS number order. */
export async function checkFleexaSms(
  orderId: string,
): Promise<{ code: string | null; message: string | null; status: string }> {
  const { messages } = await getFleexaSmsMessages(orderId);
  const latest = messages[0];
  if (!latest) return { code: null, message: null, status: "pending" };

  const code = extractOtpFromSms(latest.body);
  return { code, message: latest.body, status: code ? "delivered" : "pending" };
}

/** Latest code for a temporary-inbox order. */
export async function checkFleexaEmail(
  orderId: string,
): Promise<{ code: string | null; messages: Array<{ body: string }> }> {
  const { messages } = await getFleexaSmsMessages(orderId);
  const latest = messages[0];
  return {
    code: latest ? extractOtpFromSms(latest.body) : null,
    messages: messages.map((message) => ({ body: message.body })),
  };
}

/** Rental numbers keep every message; the caller wants the newest code. */
export async function getFleexaRentalSms(
  orderId: string,
): Promise<{ messages: Array<{ code: string | null; body: string }> }> {
  const { messages } = await getFleexaSmsMessages(orderId);
  return {
    messages: messages.map((message) => ({
      code: extractOtpFromSms(message.body),
      body: message.body,
    })),
  };
}
