/** Browse-only fields, reported by the catalogue. They do not establish
 * redemption eligibility, equivalence, stock or a customer price. */
export type ReportedGiftTerms = { country?: string; value?: { amount: number; currency: string } };

export function reportedGiftTerms(raw: unknown): ReportedGiftTerms | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const fields = raw as Record<string, unknown>;
  const country = typeof fields.country_code === "string" && /^[A-Z]{2}$/.test(fields.country_code) ? fields.country_code : undefined;
  const amount = fields.amount, faceAmount = fields.face_value_amount;
  const currency = fields.currency, faceCurrency = fields.face_value_currency;
  const validAmount = typeof amount === "number" && Number.isFinite(amount) && amount > 0 && amount <= 100_000_000 && Number.isSafeInteger(amount * 100);
  const validCurrency = typeof currency === "string" && /^[A-Z]{3}$/.test(currency);
  // Conflicting face-value fields are not silently resolved in either direction.
  const consistent = (faceAmount === undefined || faceAmount === amount) && (faceCurrency === undefined || faceCurrency === currency);
  const value = validAmount && validCurrency && consistent ? { amount, currency } : undefined;
  return country || value ? { ...(country ? { country } : {}), ...(value ? { value } : {}) } : null;
}
