const FLEEXA_BASE_URL = process.env.FLEEXA_API_URL || "https://api.fleexa.com/v1";
const FLEEXA_API_KEY = process.env.FLEEXA_API_KEY || "";

interface FleexaOrderRequest {
  service: string;
  country: string;
  app?: string;
  emailProduct?: string;
  months?: number;
}

interface FleexaOrderResponse {
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

interface FleexaSmsResponse {
  messages: Array<{
    from: string;
    body: string;
    receivedAt: string;
  }>;
}

export async function createFleexaOrder(params: FleexaOrderRequest): Promise<FleexaOrderResponse> {
  const response = await fetch(`${FLEEXA_BASE_URL}/orders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${FLEEXA_API_KEY}`,
    },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Fleexa order failed: ${error}`);
  }

  return response.json();
}

export async function getFleexaOrderStatus(orderId: string): Promise<FleexaOrderResponse> {
  const response = await fetch(`${FLEEXA_BASE_URL}/orders/${orderId}`, {
    headers: {
      Authorization: `Bearer ${FLEEXA_API_KEY}`,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to fetch Fleexa order: ${error}`);
  }

  return response.json();
}

export async function getFleexaSmsMessages(orderId: string): Promise<FleexaSmsResponse> {
  const response = await fetch(`${FLEEXA_BASE_URL}/orders/${orderId}/sms`, {
    headers: {
      Authorization: `Bearer ${FLEEXA_API_KEY}`,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to fetch SMS messages: ${error}`);
  }

  return response.json();
}

export async function cancelFleexaOrder(orderId: string): Promise<void> {
  const response = await fetch(`${FLEEXA_BASE_URL}/orders/${orderId}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${FLEEXA_API_KEY}`,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to cancel Fleexa order: ${error}`);
  }
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
  intervalMs: number = 5000
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
