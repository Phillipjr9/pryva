import { createHmac, timingSafeEqual } from "node:crypto";
import { readJsonWithLimit } from "@/lib/request-body";

const PAYSTACK_BASE_URL = "https://api.paystack.co";
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY?.trim() ?? "";
const PAYSTACK_TIMEOUT_MS = 15_000;
const PAYSTACK_RESPONSE_LIMIT = 1_048_576;

async function parsePaystackResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new Error(`Paystack request failed (${response.status})`);
  }
  return await readJsonWithLimit(response, PAYSTACK_RESPONSE_LIMIT) as T;
}

interface PaystackInitializeRequest {
  email: string;
  amount: string; // whole kobo, as required by the transaction API
  currency?: "NGN";
  reference?: string;
  callback_url?: string;
  metadata?: string; // stringified JSON
}

interface PaystackInitializeResponse {
  status: boolean;
  message: string;
  data: {
    authorization_url: string;
    access_code: string;
    reference: string;
  };
}

interface PaystackVerifyResponse {
  status: boolean;
  message: string;
  data: {
    id: number;
    status: string;
    reference: string;
    amount: number;
    currency: string;
    customer: {
      email: string;
      first_name?: string;
      last_name?: string;
    };
    paid_at: string;
  };
}

interface PaystackTransferRequest {
  source: "balance";
  amount: number; // in kobo
  currency?: "NGN";
  recipient: string;
  reason?: string;
  reference?: string;
}

interface PaystackTransferResponse {
  status: boolean;
  message: string;
  data: {
    transfer_code: string;
    status: string;
    reference: string;
    amount: number;
    currency: string;
  };
}

export async function initializePayment(params: PaystackInitializeRequest): Promise<PaystackInitializeResponse> {
  const response = await fetch(`${PAYSTACK_BASE_URL}/transaction/initialize`, {
    method: "POST",
    signal: AbortSignal.timeout(PAYSTACK_TIMEOUT_MS),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
    },
    body: JSON.stringify(params),
  });

  return parsePaystackResponse<PaystackInitializeResponse>(response);
}

export async function verifyPayment(reference: string): Promise<PaystackVerifyResponse> {
  const response = await fetch(`${PAYSTACK_BASE_URL}/transaction/verify/${reference}`, {
    signal: AbortSignal.timeout(PAYSTACK_TIMEOUT_MS),
    headers: {
      Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
    },
  });

  return parsePaystackResponse<PaystackVerifyResponse>(response);
}

export async function createTransferRecipient(params: {
  name: string;
  accountNumber: string;
  bankCode: string;
}): Promise<{ status: boolean; data: { recipient_code: string } }> {
  const response = await fetch(`${PAYSTACK_BASE_URL}/transferrecipient`, {
    method: "POST",
    signal: AbortSignal.timeout(PAYSTACK_TIMEOUT_MS),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
    },
    body: JSON.stringify({
      type: "nuban",
      name: params.name,
      account_number: params.accountNumber,
      bank_code: params.bankCode,
      currency: "NGN",
    }),
  });

  return parsePaystackResponse<{ status: boolean; data: { recipient_code: string } }>(response);
}

export async function initiateTransfer(params: PaystackTransferRequest): Promise<PaystackTransferResponse> {
  const response = await fetch(`${PAYSTACK_BASE_URL}/transfer`, {
    method: "POST",
    signal: AbortSignal.timeout(PAYSTACK_TIMEOUT_MS),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
    },
    body: JSON.stringify(params),
  });

  return parsePaystackResponse<PaystackTransferResponse>(response);
}

export async function getBanks(): Promise<Array<{ name: string; code: string }>> {
  const response = await fetch(`${PAYSTACK_BASE_URL}/bank?currency=NGN`, {
    signal: AbortSignal.timeout(PAYSTACK_TIMEOUT_MS),
    headers: {
      Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
    },
  });

  const data = await parsePaystackResponse<{ status?: boolean; data?: unknown }>(response);
  if (data.status !== true || !Array.isArray(data.data)) throw new Error("Invalid bank directory response");
  return data.data.flatMap((bank: unknown) => {
    if (!bank || typeof bank !== "object") return [];
    const value = bank as { name?: unknown; code?: unknown };
    if (typeof value.name !== "string" || !value.name.trim() || value.name.length > 100 ||
        typeof value.code !== "string" || !/^[a-z0-9]{1,20}$/i.test(value.code)) return [];
    return [{ name: value.name.trim(), code: value.code }];
  });
}

export async function resolveBankAccount(
  accountNumber: string,
  bankCode: string
): Promise<{ status: boolean; data?: { account_name?: string; account_number?: string; bank_id?: number } }> {
  const response = await fetch(
    `${PAYSTACK_BASE_URL}/bank/resolve?${new URLSearchParams({ account_number: accountNumber, bank_code: bankCode })}`,
    {
      signal: AbortSignal.timeout(PAYSTACK_TIMEOUT_MS),
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
      },
    }
  );

  return parsePaystackResponse<{ status: boolean; data?: { account_name?: string; account_number?: string; bank_id?: number } }>(response);
}

/**
 * Paystack signs the raw request body with HMAC-SHA512 using the secret key.
 *
 * Fails closed: with no secret key configured there is no way to tell a real
 * webhook from a forged one, so every webhook is rejected.
 */
export function verifyWebhookSignature(payload: string, signature: string | null): boolean {
  if (!PAYSTACK_SECRET_KEY || !signature) return false;

  const expected = createHmac("sha512", PAYSTACK_SECRET_KEY).update(payload).digest("hex");
  const expectedBuffer = Buffer.from(expected, "utf8");
  const providedBuffer = Buffer.from(signature, "utf8");

  if (expectedBuffer.length !== providedBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, providedBuffer);
}

export function isPaystackConfigured(): boolean {
  return Boolean(PAYSTACK_SECRET_KEY);
}
