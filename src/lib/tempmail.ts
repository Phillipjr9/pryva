import { randomBytes } from "node:crypto";
import { logger } from "@/lib/logger";

/**
 * Public Disposable Mailbox Provider.
 *
 * Provides instant, zero-setup temporary email addresses on live active MX domains.
 * Supports:
 * 1. Mail.tm / Mail.gw (Primary: persistent accounts, active MX domains, OpenAPI v3)
 * 2. Guerrilla Mail (Secondary: 15+ years active, instant inbox, sharklasers.com/guerrillamail.com)
 * 3. 1secmail / Public fallback (Stateless fallback)
 */

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
  return true;
}

/**
 * Generate a new disposable mailbox on active public MX domains.
 */
export async function createTempMailInbox(): Promise<TempMailOrder> {
  // 1. Try Mail.tm (api.mail.tm)
  try {
    const domainsRes = await fetch("https://api.mail.tm/domains", {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(6_000),
    });
    if (domainsRes.ok) {
      const data = (await domainsRes.json()) as { "hydra:member"?: Array<{ domain?: string; isActive?: boolean }> };
      const domains = Array.isArray(data?.["hydra:member"])
        ? data["hydra:member"].filter((d) => d.isActive && d.domain)
        : [];
      if (domains.length > 0) {
        const domain = domains[Math.floor(Math.random() * domains.length)]!.domain!;
        const username = "pryva_" + randomBytes(4).toString("hex");
        const address = `${username}@${domain}`;
        const password = "PryvaPass!" + randomBytes(4).toString("hex");

        const regRes = await fetch("https://api.mail.tm/accounts", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ address, password }),
          signal: AbortSignal.timeout(6_000),
        });
        if (regRes.ok) {
          const regData = (await regRes.json()) as { id?: string };
          const accountId = regData?.id || username;
          return {
            id: `mailtm:${accountId}:${password}`,
            address,
            domain,
            expiresAt: null,
          };
        }
      }
    }
  } catch (error) {
    logger.warn("Mail.tm inbox creation skipped, attempting Guerrilla Mail", {
      reason: error instanceof Error ? error.message : String(error),
    });
  }

  // 2. Try Guerrilla Mail
  try {
    const gRes = await fetch("https://api.guerrillamail.com/ajax.php?f=get_email_address&lang=en", {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(6_000),
    });
    if (gRes.ok) {
      const gData = (await gRes.json()) as { email_addr?: string; sid_token?: string };
      if (gData.email_addr && gData.sid_token) {
        const address = gData.email_addr;
        const domain = address.split("@")[1] || "sharklasers.com";
        return {
          id: `guerrilla:${gData.sid_token}:${address}`,
          address,
          domain,
          expiresAt: null,
        };
      }
    }
  } catch (error) {
    logger.warn("Guerrilla Mail inbox creation skipped", {
      reason: error instanceof Error ? error.message : String(error),
    });
  }

  // 3. Fallback: Generate an address on an active public temp mail domain
  const login = randomBytes(5).toString("hex");
  const domain = "sharklasers.com";
  const address = `${login}@${domain}`;
  return {
    id: `guerrilla:${login}:${address}`,
    address,
    domain,
    expiresAt: null,
  };
}

/**
 * Check Mail.tm inbox for incoming emails.
 */
async function checkMailTm(
  address: string,
  password: string,
): Promise<{ messages: TempMailMessage[]; code: string | null }> {
  try {
    const tokenRes = await fetch("https://api.mail.tm/token", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ address, password }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!tokenRes.ok) return { messages: [], code: null };
    const tokenData = (await tokenRes.json()) as { token?: string };
    const token = tokenData?.token;
    if (!token) return { messages: [], code: null };

    const msgRes = await fetch("https://api.mail.tm/messages", {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!msgRes.ok) return { messages: [], code: null };
    const msgData = (await msgRes.json()) as { "hydra:member"?: unknown[] };
    const items = Array.isArray(msgData?.["hydra:member"]) ? msgData["hydra:member"] : [];
    if (items.length === 0) return { messages: [], code: null };

    const messages: TempMailMessage[] = [];
    for (const item of items.slice(0, 10) as Array<{
      id?: string;
      subject?: string;
      from?: { address?: string; name?: string };
      intro?: string;
      createdAt?: string;
    }>) {
      if (!item?.id) continue;
      try {
        const detailRes = await fetch(`https://api.mail.tm/messages/${item.id}`, {
          headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
          signal: AbortSignal.timeout(10_000),
        });
        if (!detailRes.ok) throw new Error("Could not fetch detail");
        const detail = (await detailRes.json()) as {
          subject?: string;
          from?: { address?: string; name?: string };
          text?: string;
          intro?: string;
          html?: string[];
          createdAt?: string;
        };
        const subject = detail.subject || item.subject || null;
        const from = detail.from?.address || item.from?.address || null;
        const rawText = detail.text?.trim() || "";
        const rawIntro = detail.intro?.trim() || "";
        const rawHtml =
          Array.isArray(detail.html) && detail.html[0]
            ? detail.html[0].replace(/<[^>]+>/g, " ").trim()
            : "";
        const body = rawText || rawIntro || rawHtml || null;
        const code = extractVerificationCode(subject, body);
        const receivedAt = detail.createdAt || item.createdAt || null;
        messages.push({ subject, from, body, code, receivedAt });
      } catch {
        const subject = item.subject || null;
        const from = item.from?.address || null;
        const body = item.intro || null;
        const code = extractVerificationCode(subject, body);
        messages.push({ subject, from, body, code, receivedAt: item.createdAt || null });
      }
    }

    const directCode = messages.find((m) => m.code)?.code ?? null;
    return { messages, code: directCode };
  } catch (error) {
    logger.warn("Mail.tm poll failed", {
      reason: error instanceof Error ? error.message : String(error),
    });
    return { messages: [], code: null };
  }
}

/**
 * Check Guerrilla Mail inbox for incoming emails.
 */
async function checkGuerrillaMail(
  sidToken: string,
): Promise<{ messages: TempMailMessage[]; code: string | null }> {
  try {
    const url = `https://api.guerrillamail.com/ajax.php?f=check_email&seq=0&sid_token=${encodeURIComponent(sidToken)}`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(10_000),
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return { messages: [], code: null };
    const data = (await res.json()) as {
      list?: Array<{
        mail_id?: string;
        mail_from?: string;
        mail_subject?: string;
        mail_excerpt?: string;
        mail_date?: string;
      }>;
    };
    const items = Array.isArray(data?.list) ? data.list : [];
    // Filter out Guerrilla's initial system greeting email
    const userItems = items.filter(
      (m) => m.mail_from && !m.mail_from.includes("guerrillamail.com") && m.mail_id,
    );
    if (userItems.length === 0) return { messages: [], code: null };

    const messages: TempMailMessage[] = [];
    for (const item of userItems.slice(0, 10)) {
      try {
        const readUrl = `https://api.guerrillamail.com/ajax.php?f=fetch_email&email_id=${encodeURIComponent(String(item.mail_id))}&sid_token=${encodeURIComponent(sidToken)}`;
        const readRes = await fetch(readUrl, {
          signal: AbortSignal.timeout(10_000),
          headers: { Accept: "application/json" },
        });
        if (!readRes.ok) throw new Error("read failed");
        const detail = (await readRes.json()) as {
          mail_subject?: string;
          mail_from?: string;
          mail_body?: string;
          mail_date?: string;
        };
        const subject = detail.mail_subject || item.mail_subject || null;
        const from = detail.mail_from || item.mail_from || null;
        const body = detail.mail_body
          ? detail.mail_body.replace(/<[^>]+>/g, " ").trim()
          : item.mail_excerpt || null;
        const code = extractVerificationCode(subject, body);
        const receivedAt = detail.mail_date || item.mail_date || null;
        messages.push({ subject, from, body, code, receivedAt });
      } catch {
        const subject = item.mail_subject || null;
        const from = item.mail_from || null;
        const body = item.mail_excerpt || null;
        const code = extractVerificationCode(subject, body);
        messages.push({ subject, from, body, code, receivedAt: item.mail_date || null });
      }
    }

    const directCode = messages.find((m) => m.code)?.code ?? null;
    return { messages, code: directCode };
  } catch (error) {
    logger.warn("Guerrilla Mail poll failed", {
      reason: error instanceof Error ? error.message : String(error),
    });
    return { messages: [], code: null };
  }
}

/**
 * Check a disposable mailbox for incoming messages and extract any verification codes.
 */
export async function checkTempMail(
  providerInboxId: string,
  address?: string,
): Promise<{ messages: TempMailMessage[]; code: string | null }> {
  // 1. Mail.tm handle
  if (providerInboxId.startsWith("mailtm:")) {
    const parts = providerInboxId.split(":");
    const password = parts.slice(2).join(":") || parts[2] || "";
    if (address && password) {
      return checkMailTm(address, password);
    }
  }

  // 2. Guerrilla Mail handle
  if (providerInboxId.startsWith("guerrilla:")) {
    const parts = providerInboxId.split(":");
    const sidToken = parts[1] || "";
    if (sidToken) {
      return checkGuerrillaMail(sidToken);
    }
  }

  // 3. Generic / legacy 1secmail fallback
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
  }

  if (login && domain) {
    try {
      const url = `https://www.1secmail.com/api/v1/?action=getMessages&login=${encodeURIComponent(login)}&domain=${encodeURIComponent(domain)}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(8_000), headers: { Accept: "application/json" } });
      if (res.ok) {
        const listData = await res.json();
        if (Array.isArray(listData) && listData.length > 0) {
          const messages: TempMailMessage[] = [];
          for (const item of listData.slice(0, 10)) {
            if (!item?.id) continue;
            try {
              const readUrl = `https://www.1secmail.com/api/v1/?action=readMessage&login=${encodeURIComponent(login)}&domain=${encodeURIComponent(domain)}&id=${encodeURIComponent(String(item.id))}`;
              const readRes = await fetch(readUrl, { signal: AbortSignal.timeout(8_000), headers: { Accept: "application/json" } });
              if (!readRes.ok) continue;
              const detail = await readRes.json();
              const subject = detail?.subject || item?.subject || null;
              const from = detail?.from || item?.from || null;
              const body = detail?.textBody || detail?.body || (detail?.htmlBody ? detail.htmlBody.replace(/<[^>]+>/g, " ").trim() : null);
              const code = extractVerificationCode(subject, body);
              messages.push({ subject, from, body, code, receivedAt: detail?.date || item?.date || null });
            } catch {
              messages.push({ subject: item?.subject || null, from: item?.from || null, body: null, code: null, receivedAt: item?.date || null });
            }
          }
          return { messages, code: messages.find((m) => m.code)?.code ?? null };
        }
      }
    } catch {
      // ignore
    }
  }

  return { messages: [], code: null };
}

/**
 * Discard / cancel a temporary mailbox.
 */
export async function cancelTempMail(
  _providerInboxId: string,
  _address?: string,
): Promise<void> {
  return Promise.resolve();
}
