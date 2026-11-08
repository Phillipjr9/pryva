/**
 * Extract common verification codes without relying on a provider-specific
 * response field: many inbox APIs return the full message body and no `code`.
 */
export function extractVerificationCode(
  subject?: string | null,
  body?: string | null,
): string | null {
  const text = `${subject ?? ""} \n ${body ?? ""}`;
  if (!text.trim()) return null;

  // Explicit forward keyword match ("code: 123456", "OTP is 49201").
  const forwardMatch = text.match(
    /(?:verification code|verify code|confirmation code|security code|auth code|login code|sign-in code|otp code|otp|pin|one-time password|code)[^\w\d]{1,10}([0-9]{4,8}|(?=[A-Za-z0-9]*\d)[A-Za-z0-9]{4,8})\b/i,
  );
  if (forwardMatch?.[1]) return forwardMatch[1];

  // Explicit backward keyword match ("849201 is your verification code").
  const backwardMatch = text.match(
    /\b([0-9]{4,8}|(?=[A-Za-z0-9]*\d)[A-Za-z0-9]{4,8})[^\w\d]{1,15}(?:is your|for your|to verify|as your)?[^\w\d]{0,10}(?:verification code|confirmation code|security code|auth code|sign-in code|login code|otp|pin|code)\b/i,
  );
  if (backwardMatch?.[1]) return backwardMatch[1];

  // Prefer a code in the subject; otherwise use a standard six-digit body code.
  if (subject) {
    const subjectDigits = subject.match(/\b([0-9]{4,8})\b/);
    if (subjectDigits?.[1]) return subjectDigits[1];
  }

  const sixDigitMatch = text.match(/\b([0-9]{6})\b/);
  if (sixDigitMatch?.[1]) return sixDigitMatch[1];

  const anyDigitsMatch = text.match(/\b([0-9]{4,8})\b/);
  if (anyDigitsMatch?.[1]) return anyDigitsMatch[1];
  return null;
}

/** Remove markup and decode the basic entities used around codes in HTML mail. */
export function emailTextForCode(value: string | null): string {
  if (!value) return "";
  const codePoint = (number: number) => (number <= 0x10ffff ? String.fromCodePoint(number) : " ");
  return value
    .replace(/<(?:script|style)\b[^>]*>[\s\S]*?<\/(?:script|style)\s*>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;|&#xA0;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#x([0-9a-f]{1,6});/gi, (_, hex: string) => codePoint(Number.parseInt(hex, 16)))
    .replace(/&#([0-9]{1,7});/g, (_, dec: string) => codePoint(Number.parseInt(dec, 10)));
}
