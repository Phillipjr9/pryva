import { createHmac, timingSafeEqual } from "node:crypto";

const PAYSTACK_BASE_URL = "https://api.paystack.co";
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY || "";

interface PaystackInitializeRequest {
  email: string;
  amount: number; // in kobo
  reference?: string;
  callback_url?: string;
  metadata?: Record<string, unknown>;
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
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
    },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Paystack initialization failed: ${error}`);
  }

  return response.json();
}

export async function verifyPayment(reference: string): Promise<PaystackVerifyResponse> {
  const response = await fetch(`${PAYSTACK_BASE_URL}/transaction/verify/${reference}`, {
    headers: {
      Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Paystack verification failed: ${error}`);
  }

  return response.json();
}

export async function createTransferRecipient(params: {
  name: string;
  accountNumber: string;
  bankCode: string;
}): Promise<{ status: boolean; data: { recipient_code: string } }> {
  const response = await fetch(`${PAYSTACK_BASE_URL}/transferrecipient`, {
    method: "POST",
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

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to create transfer recipient: ${error}`);
  }

  return response.json();
}

export async function initiateTransfer(params: PaystackTransferRequest): Promise<PaystackTransferResponse> {
  const response = await fetch(`${PAYSTACK_BASE_URL}/transfer`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
    },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Paystack transfer failed: ${error}`);
  }

  return response.json();
}

export async function getBanks(): Promise<Array<{ name: string; code: string }>> {
  const response = await fetch(`${PAYSTACK_BASE_URL}/bank?currency=NGN`, {
    headers: {
      Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to fetch banks: ${error}`);
  }

  const data = await response.json();
  return data.data.map((bank: any) => ({
    name: bank.name,
    code: bank.code,
  }));
}

export async function resolveBankAccount(
  accountNumber: string,
  bankCode: string
): Promise<{ status: boolean; data: { account_name: string; account_number: string; bank_name: string } }> {
  const response = await fetch(
    `${PAYSTACK_BASE_URL}/bank/resolve?account_number=${accountNumber}&bank_code=${bankCode}`,
    {
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
      },
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to resolve bank account: ${error}`);
  }

  return response.json();
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
