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

export async function createTransferRecipient(
  name: string,
  accountNumber: string,
  bankCode: string
): Promise<{ recipientCode: string }> {
  const response = await fetch(`${PAYSTACK_BASE_URL}/transferrecipient`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
    },
    body: JSON.stringify({
      type: "nuban",
      name,
      account_number: accountNumber,
      bank_code: bankCode,
      currency: "NGN",
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to create transfer recipient: ${error}`);
  }

  const data = await response.json();
  return { recipientCode: data.data.recipient_code };
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
): Promise<{ accountName: string; accountNumber: string }> {
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

  const data = await response.json();
  return {
    accountName: data.data.account_name,
    accountNumber: data.data.account_number,
  };
}

export function verifyWebhookSignature(payload: string, signature: string): boolean {
  const crypto = require("crypto");
  const hash = crypto.createHmac("sha512", PAYSTACK_SECRET_KEY).update(payload).digest("hex");
  return hash === signature;
}
