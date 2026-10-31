import { randomBytes } from "node:crypto";
import { logger } from "@/lib/logger";

/**
 * Public Temporary Mailbox Provider (Fakemailo / 1secmail style).
 *
 * Provides instant, zero-setup disposable email addresses on public active MX domains.
 * Requires no custom domains, no mail exchange servers (MTA), and no paid API credentials.
 */

const ONESECMAIL_BASE_URL = "https://www.1secmail.com/api/v1/";
const PUBLIC_DOMAINS = ["1secmail.com", "1secmail.net", "1secmail.org"];

export type TempMailOrder = {
  id: string;
  address: string;
  domain: string;
  expiresAt: string | null;
};

export type TempMailMessage = {
  subject: string | null;
  from: string | null;
  body: string | null;
  code: string | null;
  receivedAt: string | null;
};

export class TempMailError extends Error {
  constructor(
    message: string,
    public readonly status: number = 502,
    public readonly code: string = "TEMPMAIL_ERROR",
  ) {
    super(message);
    this.name = "TempMailError";
  }
}

/**
 * Extract verification / OTP codes from message subject and body text.
 */
export function extractVerificationCode(
  subject?: string | null,
  body?: string | null,
): string | null {
  const text = `${subject ?? ""} \n ${body ?? ""}`;
  if (!text.trim()) return null;

  // 1. Explicit forward keyword match (e.g. "code: 123456", "verification code is 849201", "OTP: 49201")
  const forwardMatch = text.match(
    /(?:verification code|verify code|confirmation code|security code|auth code|login code|otp code|otp|pin|one-time password|code)[^\w\d]{1,10}([0-9]{4,8}|(?=[A-Za-z0-9]*\d)[A-Za-z0-9]{4,8})\b/i,
  );
  if (forwardMatch?.[1]) return forwardMatch[1];

  // 2. Explicit backward keyword match (e.g. "849201 is your verification code", "123456 is your code")
  const backwardMatch = text.match(
    /\b([0-9]{4,8}|(?=[A-Za-z0-9]*\d)[A-Za-z0-9]{4,8})[^\w\d]{1,15}(?:is your|for your|to verify|as your)?[^\w\d]{0,10}(?:verification code|confirmation code|security code|auth code|sign-in code|login code|otp|pin|code)\b/i,
  );
  if (backwardMatch?.[1]) return backwardMatch[1];

  // 3. Standalone 4-8 digit number in subject
  if (subject) {
    const subjectDigits = subject.match(/\b([0-9]{4,8})\b/);
    if (subjectDigits?.[1]) return subjectDigits[1];
  }

  // 4. Standalone 6-digit number in body (standard OTP length)
  const sixDigitMatch = text.match(/\b([0-9]{6})\b/);
  if (sixDigitMatch?.[1]) return sixDigitMatch[1];

  // 5. Standalone 4-8 digit number anywhere
  const anyDigitsMatch = text.match(/\b([0-9]{4,8})\b/);
  if (anyDigitsMatch?.[1]) return anyDigitsMatch[1];

  return null;
}

export function isTempMailConfigured(): boolean {
  // Public tempmail operates over standard public HTTP API and requires no secret keys or MX setups
  return true;
}

/**
 * Generate a new disposable mailbox address on active public MX domains.
 */
export async function createTempMailInbox(): Promise<TempMailOrder> {
  const login = randomBytes(5).toString("hex"); // 10 chars, e.g. "a9f3b21c0e"
  const domain = PUBLIC_DOMAINS[Math.floor(Math.random() * PUBLIC_DOMAINS.length)] ?? "1secmail.com";
  const address = `${login}@${domain}`;
  const id = `${login}:${domain}`;

  return {
    id,
    address,
    domain,
    expiresAt: null,
  };
}

/**
 * Check a disposable mailbox for incoming messages and extract any verification codes.
 */
export async function checkTempMail(
  providerInboxId: string,
  address?: string,
): Promise<{ messages: TempMailMessage[]; code: string | null }> {
  let login = "";
  let domain = "";

  if (providerInboxId.includes(":")) {
    const parts = providerInboxId.split(":");
    login = parts[0] ?? "";
    domain = parts[1] ?? "";
  } else if (address && address.includes("@")) {
    const parts = address.split("@");
    login = parts[0] ?? "";
    domain = parts[1] ?? "";
  } else if (providerInboxId.includes("@")) {
    const parts = providerInboxId.split("@");
    login = parts[0] ?? "";
    domain = parts[1] ?? "";
  }

  if (!login || !domain) {
    return { messages: [], code: null };
  }

  const url = `${ONESECMAIL_BASE_URL}?action=getMessages&login=${encodeURIComponent(login)}&domain=${encodeURIComponent(domain)}`;

  let listData: unknown;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(10_000),
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      logger.warn("Tempmail provider returned non-200 response", { status: res.status });
      return { messages: [], code: null };
    }
    listData = await res.json();
  } catch (error) {
    logger.warn("Could not check tempmail mailbox", {
      reason: error instanceof Error ? error.message : String(error),
    });
    return { messages: [], code: null };
  }

  if (!Array.isArray(listData) || listData.length === 0) {
    return { messages: [], code: null };
  }

  // Fetch full details for the top messages (max 10)
  const items = listData.slice(0, 10);
  const messages: TempMailMessage[] = [];

  for (const item of items) {
    const id = item?.id;
    if (!id) continue;

    try {
      const readUrl = `${ONESECMAIL_BASE_URL}?action=readMessage&login=${encodeURIComponent(login)}&domain=${encodeURIComponent(domain)}&id=${encodeURIComponent(String(id))}`;
      const readRes = await fetch(readUrl, {
        signal: AbortSignal.timeout(10_000),
        headers: { Accept: "application/json" },
      });
      if (!readRes.ok) continue;

      const detail = (await readRes.json()) as Record<string, unknown>;
      const subject =
        typeof detail?.subject === "string"
          ? detail.subject
          : typeof item?.subject === "string"
            ? item.subject
            : null;
      const from =
        typeof detail?.from === "string"
          ? detail.from
          : typeof item?.from === "string"
            ? item.from
            : null;

      const rawText = typeof detail?.textBody === "string" ? detail.textBody.trim() : "";
      const rawBody = typeof detail?.body === "string" ? detail.body.trim() : "";
      const rawHtml =
        typeof detail?.htmlBody === "string" ? detail.htmlBody.replace(/<[^>]+>/g, " ").trim() : "";

      const body = rawText || rawBody || rawHtml || null;
      const code = extractVerificationCode(subject, body);
      const receivedAt =
        typeof detail?.date === "string"
          ? detail.date
          : typeof item?.date === "string"
            ? item.date
            : null;

      messages.push({
        subject,
        from,
        body,
        code,
        receivedAt,
      });
    } catch {
      // Fallback to item summary if full message read fails
      const subject = typeof item?.subject === "string" ? item.subject : null;
      const from = typeof item?.from === "string" ? item.from : null;
      const code = extractVerificationCode(subject, null);
      messages.push({
        subject,
        from,
        body: null,
        code,
        receivedAt: typeof item?.date === "string" ? item.date : null,
      });
    }
  }

  const directCode = messages.find((m) => m.code)?.code ?? null;
  return { messages, code: directCode };
}

/**
 * Discard / cancel a temporary mailbox.
 */
export async function cancelTempMail(
  _providerInboxId: string,
  _address?: string,
): Promise<void> {
  // 1secmail mailboxes are stateless and do not require server-side teardown
  return Promise.resolve();
}
